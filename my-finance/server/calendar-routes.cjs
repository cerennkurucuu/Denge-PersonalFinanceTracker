const { addDays, dayDiff, isOccurrence, expandPlans, attachCandidates, forecastCashflow } = require('./calendar-engine.cjs');
const KINDS = ['salary','rent','bill','loan','credit_card','subscription','planned_income','planned_expense','savings'];
const FREQUENCIES = ['none','daily','weekly','monthly','yearly'];

function registerCalendarRoutes({ app, db, route, fail, withTransaction, localToday, isValidDate, positiveId }) {
  const rows = async (sql, values = [], connection = db) => (await connection.execute(sql, values))[0];
  const get = async (sql, values = [], connection = db) => (await rows(sql, values, connection))[0];
  const plansFor = user => rows('SELECT * FROM calendar_plans WHERE user_id=? AND archived_at IS NULL ORDER BY start_date,id', [user]);
  const stateRows = async (user, from, to) => {
    const result = await rows('SELECT * FROM calendar_occurrences WHERE user_id=? AND occurrence_date BETWEEN ? AND ? ORDER BY occurrence_date LIMIT 20001', [user,from,to]);
    if (result.length > 20000) throw Object.assign(new Error('Calendar state limit'), {status:422,publicMessage:'Bu takvim aralığı 20.000 kayıt sınırını aşıyor. Tarih aralığını daralt.'});
    return result.map(item => ({...item,amount:Number(item.amount),plan_id:Number(item.plan_id),transaction_id:item.transaction_id === null ? null : Number(item.transaction_id)}));
  };
  const actualRows = async (user, from, to) => {
    const result = await rows('SELECT t.id,t.type,t.amount,t.original_amount,t.currency_code,t.import_fingerprint,t.description,t.merchant_name,t.category_id,t.transaction_date,t.entry_kind,c.name category FROM transactions t JOIN categories c ON c.id=t.category_id AND c.user_id=t.user_id WHERE t.user_id=? AND t.transaction_date BETWEEN ? AND ? ORDER BY t.transaction_date,t.id LIMIT 100001', [user,from,to]);
    if (result.length > 100000) throw Object.assign(new Error('Calendar transaction limit'), {status:422,publicMessage:'Bu tarih aralığı 100.000 işlemi aşıyor. Aralığı daralt.'});
    return result.map(item => ({...item,id:Number(item.id),amount:Number(item.amount),original_amount:Number(item.original_amount),category_id:Number(item.category_id)}));
  };
  const validatePlan = async (body, user) => {
    if (!body || typeof body.title !== 'string' || !body.title.trim() || body.title.trim().length > 100 || !KINDS.includes(body.kind) || !FREQUENCIES.includes(body.frequency) || !['Income','Expense'].includes(body.type) || typeof body.is_fixed !== 'boolean') return 'Başlık, ödeme türü ve tekrar tercihi geçersiz.';
    if (!Number.isSafeInteger(body.amount) || body.amount <= 0 || body.amount > 1_000_000_000_000) return 'Plan tutarı pozitif kuruş cinsinden bir tam sayı olmalı.';
    if (!isValidDate(body.start_date) || body.start_date < '1900-01-01' || body.start_date > '2100-12-31' || (body.end_date && (!isValidDate(body.end_date) || body.end_date < body.start_date || body.end_date > '2100-12-31'))) return 'Başlangıç/bitiş tarihi geçersiz. 1900–2100 aralığında tarih seç.';
    if ((['salary','planned_income'].includes(body.kind) ? 'Income' : 'Expense') !== body.type) return 'Planın gelir/gider yönü ödeme türüyle eşleşmiyor.';
    if (body.kind === 'savings') return body.category_id === null ? null : 'Birikim ayırma gider kategorisine yazılmaz; kategori boş olmalı.';
    if (!Number.isSafeInteger(body.category_id) || body.category_id<=0 || !await get('SELECT id FROM categories WHERE id=? AND user_id=? AND type=?', [body.category_id,user,body.type])) return 'Bu kullanıcı ve işlem türü için geçerli kategori seç.';
    return null;
  };
  const valuesFor = body => [body.title.trim(),body.type,body.kind,body.amount,body.kind === 'savings' ? null : Number(body.category_id),body.frequency,body.start_date,body.end_date || null,body.is_fixed ? 1 : 0];

  app.get('/api/calendar/plans', route(async (req,res) => res.json(await plansFor(req.user.id))));
  app.post('/api/calendar/plans', route(async (req,res) => {
    const error = await validatePlan(req.body, req.user.id); if (error) return fail(res,400,error);
    const id = await withTransaction(async connection => {
      await get('SELECT id FROM users WHERE id=? FOR UPDATE',[req.user.id],connection);
      const count = await get('SELECT COUNT(*) count FROM calendar_plans WHERE user_id=? AND archived_at IS NULL',[req.user.id],connection);
      if (Number(count.count) >= 500) throw Object.assign(new Error('Plan limit'),{status:422,publicMessage:'En fazla 500 aktif takvim planı oluşturabilirsin.'});
      const result = await rows('INSERT INTO calendar_plans(title,type,kind,amount,category_id,frequency,start_date,end_date,is_fixed,user_id) VALUES (?,?,?,?,?,?,?,?,?,?)',[...valuesFor(req.body),req.user.id],connection);
      return Number(result.insertId);
    });
    res.status(201).json(await get('SELECT * FROM calendar_plans WHERE id=? AND user_id=?',[id,req.user.id]));
  }));
  app.put('/api/calendar/plans/:id', route(async (req,res) => {
    const id=positiveId(req.params.id); if (!id) return fail(res,400,'Plan kimliği geçersiz.');
    if (!await get('SELECT id FROM calendar_plans WHERE id=? AND user_id=? AND archived_at IS NULL',[id,req.user.id])) return fail(res,404,'Plan bulunamadı.');
    const error=await validatePlan(req.body,req.user.id); if(error)return fail(res,400,error);
    await rows('UPDATE calendar_plans SET title=?,type=?,kind=?,amount=?,category_id=?,frequency=?,start_date=?,end_date=?,is_fixed=? WHERE id=? AND user_id=? AND archived_at IS NULL',[...valuesFor(req.body),id,req.user.id]);
    res.json(await get('SELECT * FROM calendar_plans WHERE id=? AND user_id=?',[id,req.user.id]));
  }));
  app.patch('/api/calendar/plans/bulk', route(async (req,res) => {
    const ids=req.body?.ids;
    if(!Array.isArray(ids)||ids.length<1||ids.length>100||ids.some(id=>!Number.isSafeInteger(id)||id<=0)||new Set(ids).size!==ids.length) return fail(res,400,'En fazla 100 farklı ve geçerli plan seç.');
    const hasCategory=Object.hasOwn(req.body,'category_id'),hasFixed=Object.hasOwn(req.body,'is_fixed');
    if(!hasCategory&&!hasFixed||hasFixed&&typeof req.body.is_fixed!=='boolean')return fail(res,400,'Toplu güncelleme alanı geçersiz.');
    const updated=await withTransaction(async connection=>{
      const marks=ids.map(()=>'?').join(',');
      const selected=await rows(`SELECT id,type,kind FROM calendar_plans WHERE user_id=? AND archived_at IS NULL AND id IN (${marks}) FOR UPDATE`,[req.user.id,...ids],connection);
      if(selected.length!==ids.length)throw Object.assign(new Error('Plan selection changed'),{status:404,publicMessage:'Seçili planlardan biri bulunamadı veya artık etkin değil. Listeyi yenileyip tekrar dene.'});
      const sets=[],values=[];
      if(hasCategory){
        const categoryId=req.body.category_id;
        if(!Number.isSafeInteger(categoryId)||categoryId<=0||selected.some(plan=>plan.kind==='savings'||plan.type!==selected[0].type))throw Object.assign(new Error('Category mismatch'),{status:400,publicMessage:'Kategori değiştirmek için birikim planları dışında aynı yöndeki planları seç.'});
        if(!await get('SELECT id FROM categories WHERE id=? AND user_id=? AND type=?',[categoryId,req.user.id,selected[0].type],connection))throw Object.assign(new Error('Category missing'),{status:400,publicMessage:'Seçilen planların yönüyle eşleşen bir kategori seç.'});
        sets.push('category_id=?');values.push(categoryId);
      }
      if(hasFixed){sets.push('is_fixed=?');values.push(req.body.is_fixed?1:0);}
      await rows(`UPDATE calendar_plans SET ${sets.join(',')} WHERE user_id=? AND archived_at IS NULL AND id IN (${marks})`,[...values,req.user.id,...ids],connection);
      return selected.length;
    });
    res.json({updated});
  }));
  app.delete('/api/calendar/plans/:id', route(async (req,res) => {
    const id=positiveId(req.params.id); if(!id)return fail(res,400,'Plan kimliği geçersiz.');
    const result=await rows('UPDATE calendar_plans SET archived_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=? AND archived_at IS NULL',[id,req.user.id]);
    if(!result.affectedRows)return fail(res,404,'Plan bulunamadı.');
    res.status(204).end();
  }));
  app.get('/api/calendar', route(async (req,res) => {
    const {from,to}=req.query;
    if(!isValidDate(from)||!isValidDate(to)||from>to||dayDiff(from,to)>366)return fail(res,400,'Takvim için en fazla 366 günlük geçerli tarih aralığı seç.');
    const plans=await plansFor(req.user.id);
    const states=await stateRows(req.user.id,from,to);
    const transactions=await actualRows(req.user.id,from,to);
    const occurrences=attachCandidates(expandPlans(plans,states,from,to),transactions);
    const linkedIds=[...new Set(occurrences.filter(item=>item.status==='linked'&&item.transaction_id).map(item=>Number(item.transaction_id)))];
    if(linkedIds.length) {
      const placeholders=linkedIds.map(()=>'?').join(',');
      const linked=await rows(`SELECT t.id,t.transaction_date,t.description,t.amount,c.name category FROM transactions t JOIN categories c ON c.id=t.category_id AND c.user_id=t.user_id WHERE t.user_id=? AND t.id IN (${placeholders})`,[req.user.id,...linkedIds]);
      const byId=new Map(linked.map(item=>[Number(item.id),{...item,id:Number(item.id),amount:Number(item.amount)}]));
      for(const item of occurrences)item.linkedTransaction=byId.get(Number(item.transaction_id))||null;
    }
    res.json({from,to,plans,occurrences,transactions});
  }));

  app.post('/api/calendar/plans/:id/occurrences/:date', route(async (req,res) => {
    const id=positiveId(req.params.id),date=req.params.date,action=req.body?.action;
    if(!id||!isValidDate(date)||!['link','reserve','skip'].includes(action))return fail(res,400,'Plan, tarih veya gerçekleşme işlemi geçersiz.');
    try {
      await withTransaction(async connection => {
        const plan=await get('SELECT * FROM calendar_plans WHERE id=? AND user_id=? AND archived_at IS NULL FOR UPDATE',[id,req.user.id],connection);
        if(!plan)throw Object.assign(new Error('Plan missing'),{status:404,publicMessage:'Plan bulunamadı.'});
        if(!isOccurrence(plan,date))throw Object.assign(new Error('Not occurrence'),{status:400,publicMessage:'Bu tarih planın tekrar kuralıyla eşleşmiyor.'});
        if(await get('SELECT plan_id FROM calendar_occurrences WHERE plan_id=? AND user_id=? AND occurrence_date=?',[id,req.user.id,date],connection))throw Object.assign(new Error('Already recorded'),{status:409,publicMessage:'Bu plan tarihi zaten işaretlenmiş. Önce işaretlemeyi kaldır.'});
        let transactionId=null;
        if(action==='link') {
          transactionId=Number.isSafeInteger(req.body.transactionId)&&req.body.transactionId>0?req.body.transactionId:null;
          const transaction=transactionId ? await get('SELECT id,type,transaction_date,entry_kind FROM transactions WHERE id=? AND user_id=? FOR UPDATE',[transactionId,req.user.id],connection) : null;
          if(plan.kind==='savings'||!transaction||transaction.type!==plan.type||transaction.entry_kind!=='standard'||Math.abs(dayDiff(date,transaction.transaction_date))>31)throw Object.assign(new Error('Invalid link'),{status:400,publicMessage:'Aynı gelir/gider yönünde ve plan tarihine en fazla 31 gün uzaklıkta kendi işlemini seç.'});
        }
        if(action==='reserve'&&(plan.kind!=='savings'||date>localToday()))throw Object.assign(new Error('Invalid reservation'),{status:400,publicMessage:'Yalnızca bugüne veya geçmişe ait birikim tutarı ayrılabilir.'});
        await rows('INSERT INTO calendar_occurrences(plan_id,user_id,occurrence_date,status,transaction_id,title,type,kind,amount) VALUES (?,?,?,?,?,?,?,?,?)',[id,req.user.id,date,action==='link'?'linked':action==='reserve'?'reserved':'skipped',transactionId,plan.title,plan.type,plan.kind,plan.amount],connection);
      });
    } catch(error) { if(error.code==='ER_DUP_ENTRY')return fail(res,409,'Bu işlem başka bir plan tarihine bağlı. Aynı işlem iki ödemeye bağlanamaz.');throw error; }
    res.status(201).json({message:action==='link'?'Mevcut işlem bağlandı; yeni gelir/gider kaydı oluşturulmadı.':action==='reserve'?'Birikim tutarı kullanılabilir bakiyeden ayrıldı; gider oluşturulmadı.':'Bu plan tarihi atlandı.'});
  }));
  app.delete('/api/calendar/plans/:id/occurrences/:date', route(async (req,res) => {
    const id=positiveId(req.params.id),date=req.params.date;
    if(!id||!isValidDate(date))return fail(res,400,'Plan kimliği veya tarih geçersiz.');
    const result=await rows('DELETE FROM calendar_occurrences WHERE plan_id=? AND user_id=? AND occurrence_date=?',[id,req.user.id,date]);
    if(!result.affectedRows)return fail(res,404,'İşaretleme bulunamadı.');
    res.status(204).end();
  }));

  app.get('/api/cashflow', route(async (req,res) => {
    const horizon=Number(req.query.days ?? 30); if(![7,30,90].includes(horizon))return fail(res,400,'7, 30 veya 90 günlük tahmin seç.');
    const today=localToday(),end=addDays(today,89),historyStart=addDays(today,-90);
    const balance=await get("SELECT COALESCE(SUM(CASE WHEN entry_kind='refund' OR type='Income' THEN amount ELSE -amount END),0) balance,COALESCE(SUM(import_fingerprint IS NOT NULL AND currency_code='TRY' AND original_amount=CAST(DATE_FORMAT(transaction_date,'%d%m%Y') AS UNSIGNED)*100),0) issues FROM transactions WHERE user_id=? AND transaction_date<=?",[req.user.id,today]);
    if(Number(balance.issues)>0)return fail(res,422,'İçe aktarılmış kayıtlarda tarih tutar olarak okunmuş olabilir. Nakit akışı hesaplanmadan önce kaynak ekstreyle düzeltme gerekli.');
    const plans=await plansFor(req.user.id);
    const from=plans.reduce((min,plan)=>plan.start_date<min?plan.start_date:min,historyStart);
    const states=await stateRows(req.user.id,from,end);
    const actual=await actualRows(req.user.id,from,end);
    const occurrences=attachCandidates(expandPlans(plans,states,from,end),actual);
    const reserve=await get("SELECT COALESCE(SUM(amount),0) reserved FROM calendar_occurrences WHERE user_id=? AND status='reserved' AND occurrence_date<=?",[req.user.id,today]);
    const result=forecastCashflow({today,horizon,openingBalance:Number(balance.balance),reservedAmount:Number(reserve.reserved),occurrences,transactions:actual,fixedCategoryIds:plans.filter(plan=>plan.is_fixed&&plan.type==='Expense'&&plan.kind!=='savings').map(plan=>Number(plan.category_id))});
    const dismissed=new Set((await rows('SELECT fingerprint FROM calendar_alert_dismissals WHERE user_id=?',[req.user.id])).map(item=>item.fingerprint));
    result.alerts=result.alerts.filter(item=>!dismissed.has(item.fingerprint));
    result.upcoming=occurrences.filter(item=>item.status==='pending'&&item.occurrence_date<=result.end);
    res.json(result);
  }));
  app.post('/api/calendar/alerts/:fingerprint/dismiss', route(async (req,res) => {
    const fingerprint=req.params.fingerprint;if(!/^[a-f0-9]{64}$/.test(fingerprint))return fail(res,400,'Uyarı kimliği geçersiz.');
    await rows('INSERT IGNORE INTO calendar_alert_dismissals(user_id,fingerprint) VALUES (?,?)',[req.user.id,fingerprint]);
    res.status(204).end();
  }));
}

module.exports={registerCalendarRoutes};
