import { ReportsService, payrollSnapshotReport, workforceFilter, reportPage } from './reports.service';
import { tenantContext } from '../organizations/tenant-context';
const check=(id:string,gross:number,extra:any={})=>({id,employeeId:id,employeeCode:id,firstName:id,lastName:'Example',grossPay:gross,deductions:10,netPay:gross-10,components:[{name:'Basic',category:'earning',amount:gross,showInPayslip:true}],calculation:{},...extra});
const submission=(checks:any[],extra:any={})=>({organizationId:'ORG000001',period:'2026-07',status:'Submitted',checks,calculationInputs:{employees:checks.map(c=>({employeeId:c.employeeId,annualCtc:120000}))},idempotencyKey:'run-one',...extra}) as any;
describe('Historical payroll snapshot reports',()=>{
 it('includes only July finalized employees A and B, even when B is terminated later, and never fetches current employees',async()=>{
  const employees={find:jest.fn()};
  const run=submission([check('A',100),check('B',200)]);
  const query={select:jest.fn().mockReturnThis(),lean:jest.fn().mockReturnThis(),exec:jest.fn().mockResolvedValue(run)};
  const runs={findOne:jest.fn().mockReturnValue(query)};
  const service=new ReportsService(employees as any,runs as any);
  const report=await tenantContext.run({organizationId:'ORG000001'},()=>service.payroll('2026-07',{}));
  expect(report.rows.map(r=>r.employeeCode)).toEqual(['A','B']);
  expect(report.summary).toMatchObject({employees:2,grossPay:300,deductions:20,netPay:280,pending:2});
  expect(report.rows[1].annualCtc).toBe(120000);
  expect(report.rows[1]['component:earning:Basic']).toBe(200);
  expect(employees.find).not.toHaveBeenCalled();
  expect(runs.findOne).toHaveBeenCalledWith({organizationId:'ORG000001',period:'2026-07',status:'Submitted'});
 });
 it('combines finalized submissions without duplicate counting and excludes drafts',()=>{
  const run=submission([check('A',100)],{additionalSubmissions:[submission([check('B',200,{paymentStatus:'Paid',designation:'Engineer'})],{idempotencyKey:'run-two'}),submission([check('A',100)],{idempotencyKey:'duplicate'}),submission([check('C',300)],{status:'Draft'})]});
  const report=payrollSnapshotReport(run);
  expect(report.rows).toHaveLength(2);expect(report.summary.paid).toBe(1);expect(report.summary.grossPay).toBe(300);
  expect(report.rows[1]).toMatchObject({designation:'Engineer',run:'run-two'});
  expect(report.rows[0].designation).toBeNull();
  expect(payrollSnapshotReport(submission([check('A',90)],{period:'2026-08'})).rows.map(r=>r.employeeCode)).toEqual(['A']);
 });
 it('uses stored annual CTC and paginates rows without changing totals',async()=>{
  const run=submission([check('A',100,{calculation:{annual:{annualCtc:240000}}}),check('B',200)]);
  const runs={findOne:()=>({select:()=>({lean:()=>({exec:async()=>run})})})};
  const report=await new ReportsService({} as any,runs as any).payroll('2026-07',{page:'2',limit:'1'});
  expect(report.rows.map(r=>r.employeeCode)).toEqual(['B']);expect(report.total).toBe(2);expect(report.summary.grossPay).toBe(300);
  expect(payrollSnapshotReport(run).rows[0].annualCtc).toBe(240000);
 });
 it('rejects unavailable periods and invalid pagination',async()=>{
  const service=new ReportsService({} as any,{findOne:()=>({select:()=>({lean:()=>({exec:async()=>null})})})} as any);
  await expect(service.payroll('2026-07',{})).rejects.toThrow('No processed payroll');
  await expect(service.payroll('2026-99',{})).rejects.toThrow('valid payroll');
  expect(()=>reportPage({page:'-1'})).toThrow();expect(()=>reportPage({limit:'1000'})).toThrow();
 });
});
describe('Dashboard and workforce reporting',()=>{
 it('aggregates stored annual CTC only for active and legacy active records, and divides by twelve',async()=>{
  const employees={aggregate:jest.fn().mockResolvedValue([{activeEmployees:2,annualRunRate:360000,activeEmployeeIds:['A','B']}])};
  const service=new ReportsService(employees as any,{} as any);
  expect(await service.dashboard()).toMatchObject({activeEmployees:2,annualRunRate:360000,monthlyRunRate:30000});
  expect(employees.aggregate.mock.calls[0][0]).toEqual([{$match:{$or:[{status:'Active'},{status:null}]}},{$group:{_id:null,activeEmployees:{$sum:1},annualRunRate:{$sum:'$annualCtc'},activeEmployeeIds:{$push:{$toString:'$_id'}}}}]);
  employees.aggregate.mockResolvedValue([]);expect(await service.dashboard()).toMatchObject({annualRunRate:0,monthlyRunRate:0});
  employees.aggregate.mockResolvedValue([{activeEmployees:1,annualRunRate:240000}]);expect((await service.dashboard()).monthlyRunRate).toBe(20000);
 });
 it('filters by employment status and inclusive joining dates without inventing departments',()=>{
  const filter=workforceFilter({status:'Active',joinedFrom:'2026-01-01',joinedTo:'2026-07-31'});
  expect(filter.$or).toEqual([{status:'Active'},{status:null}]);
  expect(filter.hireDate).toEqual({$gte:new Date('2026-01-01T00:00:00Z'),$lt:new Date('2026-08-01T00:00:00Z')});
  expect(()=>workforceFilter({joinedFrom:'2026-02-30'})).toThrow();
  expect(()=>workforceFilter({status:'$ne'})).toThrow();
 });
});

describe('Report database projections',()=>{
 it('returns paginated workforce fields and matching status summaries',async()=>{
  const query={select:jest.fn().mockReturnThis(),sort:jest.fn().mockReturnThis(),skip:jest.fn().mockReturnThis(),limit:jest.fn().mockReturnThis(),lean:jest.fn().mockReturnThis(),exec:jest.fn().mockResolvedValue([{employeeId:'EMP001',firstName:'Ada',lastName:'Example',designation:'Engineer',hireDate:new Date('2026-01-01'),status:'Terminated',annualCtc:120000}])};
  const employees={find:jest.fn().mockReturnValue(query),countDocuments:jest.fn().mockResolvedValue(51),aggregate:jest.fn().mockResolvedValue([{_id:'Terminated',count:51}])};
  const result=await new ReportsService(employees as any,{} as any).workforce({status:'Terminated',page:'2',limit:'50'});
  expect(employees.find).toHaveBeenCalledWith({status:'Terminated'});expect(query.skip).toHaveBeenCalledWith(50);
  expect(result.rows[0]).toMatchObject({employeeCode:'EMP001',name:'Ada Example',designation:'Engineer',status:'Terminated',annualCtc:120000});
  expect(result.summary).toEqual({employees:51,Terminated:51});
 });
 it('lists only the authenticated organization finalized periods without loading check data',async()=>{
  const query={select:jest.fn().mockReturnThis(),sort:jest.fn().mockReturnThis(),lean:jest.fn().mockReturnThis(),exec:jest.fn().mockResolvedValue([{period:'2026-07',idempotencyKey:'one',additionalSubmissions:[{idempotencyKey:'two'}]}])};
  const runs={find:jest.fn().mockReturnValue(query)};
  const result=await tenantContext.run({organizationId:'ORG000002'},()=>new ReportsService({} as any,runs as any).periods());
  expect(runs.find).toHaveBeenCalledWith({organizationId:'ORG000002',status:'Submitted'});expect(result).toEqual([{period:'2026-07',runs:['one','two']}]);
  expect(query.select.mock.calls[0][0]).not.toContain('checks');
 });
});
