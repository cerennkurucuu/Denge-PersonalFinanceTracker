const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const path=require('node:path');
const request=require('supertest');
require('../../scripts/load-local-env.cjs')(path.join(__dirname,'../..'));
if(process.env.MYSQL_TEST_MODE!=='1'||process.env.NODE_ENV==='production')throw new Error('Calendar tests require a non-production MYSQL_TEST_MODE=1 database.');
const {app,db,migrate}=require('../mysql-server.cjs');
const {addDays}=require('../calendar-engine.cjs');
const users=[];
let today;
async function createUser() {
  const suffix=crypto.randomUUID();
  const [user]=await db.execute('INSERT INTO users(google_sub,email,name) VALUES (?,?,?)',[`calendar-test-${suffix}`,`calendar-test-${suffix}@example.invalid`,'Calendar test']);
  const entry={id:Number(user.insertId)};users.push(entry);
  for(const type of ['Income','Expense']){
    const [category]=await db.execute('INSERT INTO categories(user_id,name,type,color,icon,is_default,is_preferred) VALUES (?,?,?,?,?,1,1)',[entry.id,type,type,'#35644c','circle']);
    entry[type]=Number(category.insertId);
  }
  await db.execute("INSERT INTO settings(user_id,currency,theme,language) VALUES (?,'TRY','light','tr')",[entry.id]);
  const token=crypto.randomBytes(32).toString('base64url');
  await db.execute('INSERT INTO auth_sessions(token_hash,user_id,expires_at) VALUES (?,?,?)',[crypto.createHash('sha256').update(token).digest('hex'),entry.id,Math.floor(Date.now()/1000)+600]);
  entry.call=(method,url)=>request(app)[method](url).set('Cookie',`denge_session=${token}`);
  return entry;
}
before(async()=>{await migrate();today=new Date().toLocaleDateString('en-CA',{timeZone:'Europe/Istanbul'});await createUser();await createUser();});
after(async()=>{
  for(const user of users){
    await db.execute('DELETE FROM calendar_plans WHERE user_id=?',[user.id]);
    await db.execute('DELETE FROM transactions WHERE user_id=?',[user.id]);
    await db.execute('DELETE FROM categories WHERE user_id=?',[user.id]);
    await db.execute('DELETE FROM settings WHERE user_id=?',[user.id]);
    await db.execute('DELETE FROM auth_sessions WHERE user_id=?',[user.id]);
    await db.execute('DELETE FROM users WHERE id=?',[user.id]);
  }
  await db.end();
});
const plan=(fields={})=>({title:'Takvim test faturası',type:'Expense',kind:'bill',amount:20000,category_id:users[0].Expense,frequency:'monthly',start_date:today,end_date:null,is_fixed:true,...fields});
const transaction=(type,amount,date=today)=>({type,amount,original_amount:amount,currency_code:'TRY',exchange_rate:1,rate_source:'TRY',tcmb_rate:null,rate_effective_date:null,description:`Calendar ${type} test`,category_id:users[0][type],transaction_date:date});

test('calendar validates plans and isolates all reads, edits, linking and deletion by authenticated owner',async()=>{
  const [owner,other]=users;
  await request(app).get('/api/calendar/plans').expect(401);
  await owner.call('post','/api/calendar/plans').send(plan({amount:0})).expect(400);
  await owner.call('post','/api/calendar/plans').send(plan({amount:-10})).expect(400);
  await owner.call('post','/api/calendar/plans').send(plan({amount:1.1})).expect(400);
  await owner.call('post','/api/calendar/plans').send(plan({end_date:addDays(today,-1)})).expect(400);
  await owner.call('post','/api/calendar/plans').send(plan({category_id:other.Expense})).expect(400);
  await owner.call('post','/api/calendar/plans').send(plan({kind:'salary'})).expect(400);
  await owner.call('post','/api/calendar/plans').send(plan({frequency:'unknown'})).expect(400);
  await owner.call('get',`/api/calendar?from=${today}&to=${addDays(today,367)}`).expect(400);
  await owner.call('get','/api/cashflow?days=8').expect(400);
  const created=(await owner.call('post','/api/calendar/plans').send(plan()).expect(201)).body;
  await other.call('get','/api/calendar/plans').expect(200,[]);
  await other.call('put',`/api/calendar/plans/${created.id}`).send(plan()).expect(404);
  await other.call('delete',`/api/calendar/plans/${created.id}`).expect(404);
  await other.call('post',`/api/calendar/plans/${created.id}/occurrences/${today}`).send({action:'skip'}).expect(404);
  await other.call('delete',`/api/calendar/plans/${created.id}/occurrences/${today}`).expect(404);
  const read=await owner.call('get',`/api/calendar?from=${today}&to=${addDays(today,6)}`).expect(200);
  assert.equal(read.body.occurrences.length,1);
  await owner.call('delete',`/api/calendar/plans/${created.id}`).expect(204);
});

test('bulk plan updates are atomic, validated and scoped to the signed-in user',async()=>{
  const [owner,other]=users;
  const first=(await owner.call('post','/api/calendar/plans').send(plan({title:'Toplu plan 1'})).expect(201)).body;
  const second=(await owner.call('post','/api/calendar/plans').send(plan({title:'Toplu plan 2'})).expect(201)).body;
  await other.call('patch','/api/calendar/plans/bulk').send({ids:[first.id,second.id],is_fixed:false}).expect(404);
  await owner.call('patch','/api/calendar/plans/bulk').send({ids:[first.id,second.id],category_id:owner.Income}).expect(400);
  await owner.call('patch','/api/calendar/plans/bulk').send({ids:[first.id,999999999],is_fixed:false}).expect(404);
  const updated=await owner.call('patch','/api/calendar/plans/bulk').send({ids:[first.id,second.id],category_id:owner.Expense,is_fixed:false}).expect(200);
  assert.equal(updated.body.updated,2);
  const [saved]=await db.execute('SELECT id,category_id,is_fixed FROM calendar_plans WHERE user_id=? AND id IN (?,?) ORDER BY id',[owner.id,first.id,second.id]);
  assert.equal(saved.length,2);assert.ok(saved.every(item=>Number(item.category_id)===owner.Expense&&Number(item.is_fixed)===0));
  await owner.call('delete',`/api/calendar/plans/${first.id}`).expect(204);
  await owner.call('delete',`/api/calendar/plans/${second.id}`).expect(204);
});

test('linking, reservations, forecasts and persisted alert dismissals do not create duplicate ledger entries',async()=>{
  const [owner,other]=users;
  await owner.call('post','/api/transactions').send(transaction('Income',100000)).expect(201);
  const expense=(await owner.call('post','/api/transactions').send(transaction('Expense',20000)).expect(201)).body;
  const bill=(await owner.call('post','/api/calendar/plans').send(plan()).expect(201)).body;
  const beforeLink=(await owner.call('get','/api/cashflow?days=7').expect(200)).body;
  assert.equal(beforeLink.requiresReconciliation,true);assert.equal(beforeLink.endBalance.plannedBalance,null);
  await other.call('post','/api/transactions').send({...transaction('Expense',20000),category_id:other.Expense}).expect(201);
  const foreign=(await other.call('get','/api/transactions').expect(200)).body[0];
  await owner.call('post',`/api/calendar/plans/${bill.id}/occurrences/${today}`).send({action:'link',transactionId:foreign.id}).expect(400);
  await owner.call('post',`/api/calendar/plans/${bill.id}/occurrences/${addDays(today,1)}`).send({action:'skip'}).expect(400);
  await owner.call('post',`/api/calendar/plans/${bill.id}/occurrences/${today}`).send({action:'link',transactionId:expense.id}).expect(201);
  await owner.call('post',`/api/calendar/plans/${bill.id}/occurrences/${today}`).send({action:'link',transactionId:expense.id}).expect(409);
  const linkedCalendar=(await owner.call('get',`/api/calendar?from=${today}&to=${addDays(today,6)}`).expect(200)).body;
  const linkedOccurrence=linkedCalendar.occurrences.find(item=>item.plan_id===bill.id&&item.occurrence_date===today);
  assert.equal(linkedOccurrence.status,'linked');
  assert.equal(linkedOccurrence.linkedTransaction.id,expense.id);
  assert.equal(linkedOccurrence.linkedTransaction.description,'Calendar Expense test');
  const linked=(await owner.call('get','/api/cashflow?days=7').expect(200)).body;
  assert.equal(linked.openingBalance,80000);assert.equal(linked.endBalance.plannedBalance,80000);assert.equal(linked.enoughHistory,false);assert.equal(linked.endBalance.estimatedBalance,null);assert.ok(linked.monthEnd);
  assert.equal((await owner.call('get','/api/transactions').expect(200)).body.length,2);
  const duplicatePlan=(await owner.call('post','/api/calendar/plans').send(plan({title:'Aynı kaydı ikinci kez bağlama'})).expect(201)).body;
  await owner.call('post',`/api/calendar/plans/${duplicatePlan.id}/occurrences/${today}`).send({action:'link',transactionId:expense.id}).expect(409);
  await owner.call('delete',`/api/calendar/plans/${duplicatePlan.id}`).expect(204);

  const tomorrow=addDays(today,1);
  const futureIncome=(await owner.call('post','/api/transactions').send(transaction('Income',30000,tomorrow)).expect(201)).body;
  const salary=(await owner.call('post','/api/calendar/plans').send(plan({title:'Maaş',type:'Income',kind:'salary',amount:30000,category_id:owner.Income,start_date:tomorrow})).expect(201)).body;
  await owner.call('post',`/api/calendar/plans/${salary.id}/occurrences/${tomorrow}`).send({action:'link',transactionId:futureIncome.id}).expect(201);
  assert.equal((await owner.call('get','/api/cashflow?days=7').expect(200)).body.endBalance.plannedBalance,110000);
  const savings=(await owner.call('post','/api/calendar/plans').send(plan({title:'Birikim',kind:'savings',category_id:null,amount:5000,frequency:'none'})).expect(201)).body;
  await owner.call('post',`/api/calendar/plans/${savings.id}/occurrences/${today}`).send({action:'reserve'}).expect(201);
  const reserved=(await owner.call('get','/api/cashflow?days=7').expect(200)).body;
  assert.equal(reserved.availableNow,75000);assert.equal(reserved.endBalance.plannedBalance,105000);assert.equal(reserved.paymentBurden,0);
  assert.equal((await owner.call('get','/api/transactions').expect(200)).body.length,3);
  const rent=(await owner.call('post','/api/calendar/plans').send(plan({title:'Yüksek kira',kind:'rent',amount:200000,start_date:tomorrow})).expect(201)).body;
  const shortage=(await owner.call('get','/api/cashflow?days=7').expect(200)).body;
  assert.equal(shortage.firstShortage.date,tomorrow);
  const alert=shortage.alerts.find(item=>item.type==='shortage');assert.ok(alert);
  await other.call('post',`/api/calendar/alerts/${alert.fingerprint}/dismiss`).send({}).expect(204);
  assert.ok((await owner.call('get','/api/cashflow?days=7').expect(200)).body.alerts.some(item=>item.fingerprint===alert.fingerprint));
  await owner.call('post',`/api/calendar/alerts/${alert.fingerprint}/dismiss`).send({}).expect(204);
  assert.equal((await owner.call('get','/api/cashflow?days=7').expect(200)).body.alerts.some(item=>item.fingerprint===alert.fingerprint),false);
  await owner.call('delete',`/api/calendar/plans/${rent.id}`).expect(204);

  await owner.call('put',`/api/calendar/plans/${bill.id}`).send(plan({title:'Yeni başlık',amount:25000,frequency:'weekly'})).expect(200);
  const edited=(await owner.call('get',`/api/calendar?from=${today}&to=${tomorrow}`).expect(200)).body.occurrences.find(item=>item.plan_id===bill.id);
  assert.equal(edited.title,'Takvim test faturası');assert.equal(edited.amount,20000);assert.equal(edited.status,'linked');
  await owner.call('delete',`/api/calendar/plans/${bill.id}`).expect(204);
  const archived=(await owner.call('get',`/api/calendar?from=${today}&to=${tomorrow}`).expect(200)).body;
  assert.ok(archived.occurrences.some(item=>item.plan_id===bill.id&&item.status==='linked'));
  await owner.call('delete',`/api/transactions/${futureIncome.id}`).expect(204);
  const afterDelete=(await owner.call('get',`/api/calendar?from=${today}&to=${tomorrow}`).expect(200)).body.occurrences.find(item=>item.plan_id===salary.id);
  assert.equal(afterDelete.status,'pending');
  assert.equal((await owner.call('get','/api/cashflow?days=7').expect(200)).body.endBalance.plannedBalance,105000);
  await owner.call('delete',`/api/calendar/plans/${savings.id}/occurrences/${today}`).expect(204);
  assert.equal((await owner.call('get','/api/cashflow?days=7').expect(200)).body.reservedAmount,0);
});
