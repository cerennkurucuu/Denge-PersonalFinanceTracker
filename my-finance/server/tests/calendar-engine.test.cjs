const {test}=require('node:test');
const assert=require('node:assert/strict');
const {addDays,occurrenceDate,isOccurrence,expandPlans,attachCandidates,forecastCashflow}=require('../calendar-engine.cjs');
const plan=(overrides={})=>({id:1,title:'Kira',type:'Expense',kind:'rent',amount:10000,category_id:1,frequency:'monthly',start_date:'2026-01-31',end_date:null,is_fixed:1,...overrides});
const forecast=(overrides={})=>forecastCashflow({today:'2026-11-07',horizon:7,openingBalance:100000,occurrences:[],transactions:[],...overrides});
const pending=(overrides={})=>({plan_id:1,occurrence_date:'2026-11-08',title:'Fatura',type:'Expense',kind:'bill',amount:20000,category_id:1,status:'pending',transaction_id:null,candidateTransactionIds:[],...overrides});

test('monthly recurrence clamps short months without drifting away from day 31',()=>{
  const p=plan();assert.equal(occurrenceDate(p,1),'2026-02-28');assert.equal(occurrenceDate(p,2),'2026-03-31');
  assert.ok(isOccurrence(p,'2026-02-28'));assert.equal(isOccurrence(p,'2026-03-28'),false);
  assert.deepEqual(expandPlans([p],[],'2026-02-01','2026-03-31').map(item=>item.occurrence_date),['2026-02-28','2026-03-31']);
});
test('yearly leap-day anchors return to February 29 in the next leap year',()=>{
  const p=plan({start_date:'2024-02-29',frequency:'yearly'});
  assert.equal(occurrenceDate(p,1),'2025-02-28');assert.equal(occurrenceDate(p,4),'2028-02-29');
});
test('daily, weekly, one-off and end-date rules generate only applicable dates',()=>{
  const p=plan({start_date:'2026-11-07',frequency:'weekly',end_date:'2026-11-21'});
  assert.deepEqual(expandPlans([p],[],'2026-11-08','2026-12-10').map(item=>item.occurrence_date),['2026-11-14','2026-11-21']);
  assert.equal(expandPlans([plan({frequency:'none'})],[],'2026-02-01','2026-03-01').length,0);
  assert.equal(expandPlans([plan({frequency:'daily',start_date:'2026-11-07',end_date:'2026-11-09'})],[],'2026-11-07','2026-12-01').length,3);
});
test('completed occurrence snapshots survive edits and plan archival',()=>{
  const state={plan_id:1,occurrence_date:'2026-02-28',title:'Eski kira',type:'Expense',kind:'rent',amount:10000,status:'linked',transaction_id:9};
  const result=expandPlans([plan({amount:20000,start_date:'2026-03-10',archived_at:'2026-03-01'})],[state],'2026-02-01','2026-03-31');
  assert.equal(result.length,1);assert.equal(result[0].title,'Eski kira');assert.equal(result[0].amount,10000);
});
test('insufficient history returns known plan balances but no spending-based prediction',()=>{
  const result=forecast({occurrences:[pending()]});
  assert.equal(result.endBalance.plannedBalance,80000);assert.equal(result.endBalance.estimatedBalance,null);assert.equal(result.enoughHistory,false);
});
test('month-end output is available independently of the seven-day horizon',()=>{
  const result=forecast({occurrences:[pending({occurrence_date:'2026-11-30',amount:50000})]});
  assert.equal(result.series.length,7);assert.equal(result.endBalance.plannedBalance,100000);assert.equal(result.monthEnd.plannedBalance,50000);assert.equal(result.paymentBurden,0);
});
test('linked current and future transactions are counted exactly once',()=>{
  const linked=pending({status:'linked',transaction_id:9});
  assert.equal(forecast({openingBalance:80000,occurrences:[linked]}).endBalance.plannedBalance,80000);
  const future=forecast({occurrences:[linked],transactions:[{id:9,type:'Expense',entry_kind:'standard',amount:20000,transaction_date:'2026-11-08'}]});
  assert.equal(future.endBalance.plannedBalance,80000);assert.equal(future.paymentBurden,20000);
});
test('unresolved matching actual transactions stop projection instead of double-counting',()=>{
  const transactions=[{id:9,type:'Expense',entry_kind:'standard',amount:20000,category_id:1,transaction_date:'2026-11-08'}];
  const occurrences=attachCandidates([pending()],transactions);
  assert.deepEqual(occurrences[0].candidateTransactionIds,[9]);
  const result=forecast({occurrences,transactions});assert.equal(result.requiresReconciliation,true);assert.equal(result.endBalance.plannedBalance,null);assert.equal(result.paymentBurden,null);
});
test('reserved savings reduce available funds without creating consumption expense',()=>{
  const result=forecast({reservedAmount:10000,occurrences:[pending({kind:'savings',amount:5000})]});
  assert.equal(result.availableNow,90000);assert.equal(result.endBalance.plannedBalance,85000);assert.equal(result.paymentBurden,0);assert.equal(result.savingsAllocations,5000);
});
test('overdue obligations move to today and identify the first negative date',()=>{
  const result=forecast({openingBalance:10000,occurrences:[pending({occurrence_date:'2026-11-01',amount:20000})]});
  assert.equal(result.series[0].plannedDelta,-20000);assert.equal(result.firstShortage.date,'2026-11-07');assert.ok(result.alerts.some(item=>item.type==='shortage'));
});
test('overdue unpaid income does not mask a cash shortage by being assumed received today',()=>{
  const result=forecast({openingBalance:10000,occurrences:[pending({occurrence_date:'2026-11-01',type:'Income',amount:1000000}),pending({occurrence_date:'2026-11-07',amount:20000})]});
  assert.equal(result.upcomingIncome,0);assert.equal(result.endBalance.plannedBalance,-10000);assert.equal(result.firstShortage.date,'2026-11-07');
});
test('sufficient history forecasts variable expenses and excludes fixed rent from daily averaging',()=>{
  const today='2026-11-07';
  const transactions=[{id:100,type:'Income',amount:100000,transaction_date:addDays(today,-90),category_id:2}];
  for(let i=0;i<13;i++)transactions.push({id:i+1,type:'Expense',amount:900,transaction_date:addDays(today,-89+i*7),category_id:3,description:`Market ${i}`});
  transactions.push({id:200,type:'Expense',amount:50000,transaction_date:addDays(today,-10),category_id:1,description:'Kira'});
  const result=forecast({transactions,fixedCategoryIds:[1]});
  assert.equal(result.enoughHistory,true);assert.equal(result.series[0].estimatedVariableExpense,0);assert.equal(result.endBalance.estimatedVariableExpense,780);assert.equal(result.endBalance.estimatedBalance,99220);
  const covered=forecast({transactions,fixedCategoryIds:[1],occurrences:[pending({amount:1000,is_fixed:false})]});
  assert.equal(covered.endBalance.estimatedVariableExpense,0);assert.equal(covered.endBalance.estimatedBalance,99000);
});
test('unplanned monthly repeats are not extrapolated as daily expenses',()=>{
  const transactions=['2026-08-10','2026-09-10','2026-10-10'].map((date,index)=>({id:index+1,type:'Expense',amount:50000,transaction_date:date,category_id:1,merchant_name:'Ev kirası'}));
  const result=forecast({transactions});assert.equal(result.enoughHistory,false);assert.equal(result.endBalance.estimatedBalance,null);assert.ok(result.warnings.some(item=>item.includes('aylık tekrarlayan')));
});
test('unsafe monetary sums fail explicitly instead of returning an imprecise balance',()=>{
  assert.throws(()=>forecast({openingBalance:Number.MAX_SAFE_INTEGER,occurrences:[pending({type:'Income'})]}),/Unsafe cashflow/);
  assert.throws(()=>forecast({openingBalance:Number.MAX_SAFE_INTEGER+1,reservedAmount:Number.MAX_SAFE_INTEGER+1}),/Unsafe cashflow/);
  assert.throws(()=>forecast({horizon:8}),/Invalid cashflow/);
});
