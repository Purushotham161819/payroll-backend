import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Employee } from '../employees/schemas/employee.schema';
import { PayrollRun } from '../run-payroll/schemas/payroll-run.schema';
import { tenantContext } from '../organizations/tenant-context';
import { sumMoney } from '../run-payroll/run-payroll.service';

export type ReportColumn = {key:string; label:string; kind:'text'|'money'|'date'};
const workforceColumns: ReportColumn[] = [
 {key:'employeeCode',label:'Employee ID',kind:'text'}, {key:'name',label:'Employee Name',kind:'text'},
 {key:'designation',label:'Designation',kind:'text'}, {key:'hireDate',label:'Date of Joining',kind:'date'},
 {key:'status',label:'Employment Status',kind:'text'}, {key:'annualCtc',label:'Annual CTC',kind:'money'},
];
export function reportPage(query: Record<string,string>) {
 const page = Number(query.page ?? 1), limit = Number(query.limit ?? 50);
 if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new BadRequestException('Invalid report page or page size.');
 return {page,limit};
}
export function workforceFilter(query: Record<string,string>) {
 const filter: Record<string,unknown> = {};
 if (query.status) {
  if (!['Active','Terminated'].includes(query.status)) throw new BadRequestException('Invalid employment status.');
  Object.assign(filter, query.status === 'Active' ? {$or:[{status:'Active'},{status:null}]} : {status:query.status});
 }
 const range: Record<string,Date> = {};
 for (const [key,op] of [['joinedFrom','$gte'],['joinedTo','$lt']]) if (query[key]) {
  const value = query[key]; const date = new Date(value + 'T00:00:00Z');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0,10) !== value) throw new BadRequestException('Invalid joining date.');
  range[op] = op === '$lt' ? new Date(date.getTime()+86400000) : date;
 }
 if (query.joinedFrom && query.joinedTo && query.joinedFrom > query.joinedTo) throw new BadRequestException('Joining date range is reversed.');
 if (Object.keys(range).length) filter.hireDate = range;
 return filter;
}
// Pure snapshot projection: never consult current employee records for historical reports.
export function payrollSnapshotReport(run: PayrollRun) {
 const submissions = [run,...(run.additionalSubmissions ?? [])].filter(s=>s.status === 'Submitted');
 const seen = new Set<string>();
 const rows = submissions.flatMap(s=>s.checks.flatMap(check=>{
  if (seen.has(check.employeeId)) return [];
  seen.add(check.employeeId);
  const inputs = s.calculationInputs as {employees?:{employeeId:string;annualCtc:number}[]};
  const calculation = check.calculation as {annual?:{annualCtc?:number}};
  const row: Record<string,string|number|null> = {
   employeeCode:check.employeeCode ?? check.employeeId,name:[check.firstName,check.lastName].filter(Boolean).join(' '),designation:check.designation ?? null,
   run:s.idempotencyKey ?? 'Legacy submission',processedAt:s.submittedAt?.toISOString?.() ?? (s.submittedAt ? String(s.submittedAt) : null),
   annualCtc:calculation?.annual?.annualCtc ?? inputs?.employees?.find(e=>e.employeeId===check.employeeId)?.annualCtc ?? null,
   grossPay:check.grossPay,deductions:check.deductions,tds:check.tds ?? null,netPay:check.netPay,paymentStatus:check.paymentStatus ?? 'Payment Pending',
  };
  for(const c of check.components) { const key='component:'+c.category+':'+c.name; row[key]=sumMoney([Number(row[key] ?? 0),c.amount]); }
  return [row];
 }));
 const columns:ReportColumn[] = [
  {key:'employeeCode',label:'Employee ID',kind:'text'},{key:'name',label:'Employee Name',kind:'text'},
  {key:'designation',label:'Designation (snapshot)',kind:'text'},{key:'run',label:'Processing Run',kind:'text'},
  {key:'processedAt',label:'Processed On',kind:'date'},{key:'annualCtc',label:'Annual CTC (snapshot)',kind:'money'},
  ...[...new Set(rows.flatMap(r=>Object.keys(r).filter(k=>k.startsWith('component:'))))].map(key=>({key,label:key.slice(10),kind:'money' as const})),
  {key:'grossPay',label:'Gross Earnings',kind:'money'},{key:'deductions',label:'Total Deductions',kind:'money'},
  {key:'tds',label:'TDS',kind:'money'},{key:'netPay',label:'Net Pay',kind:'money'},{key:'paymentStatus',label:'Payment Status',kind:'text'},
 ];
 return {columns,rows,summary:{employees:rows.length,grossPay:sumMoney(rows.map(r=>Number(r.grossPay))),deductions:sumMoney(rows.map(r=>Number(r.deductions))),netPay:sumMoney(rows.map(r=>Number(r.netPay))),paid:rows.filter(r=>r.paymentStatus==='Paid').length,pending:rows.filter(r=>r.paymentStatus==='Payment Pending').length}};
}
@Injectable()
export class ReportsService {
 constructor(@InjectModel(Employee.name) private readonly employees:Model<Employee>, @InjectModel('PayrollRun') private readonly runs:Model<PayrollRun>) {}
 async dashboard() {
  const [summary] = await this.employees.aggregate([
   {$match:{$or:[{status:'Active'},{status:null}]}},
   {$group:{_id:null,activeEmployees:{$sum:1},annualRunRate:{$sum:'$annualCtc'},activeEmployeeIds:{$push:{$toString:'$_id'}}}},
  ]);
  return {activeEmployees:summary?.activeEmployees ?? 0,annualRunRate:summary?.annualRunRate ?? 0,monthlyRunRate:(summary?.annualRunRate ?? 0)/12,activeEmployeeIds:summary?.activeEmployeeIds ?? [],currency:'INR'};
 }
 async workforce(query:Record<string,string>) {
  const {page,limit} = reportPage(query), filter = workforceFilter(query);
  const [items,total,statuses] = await Promise.all([
   this.employees.find(filter).select('employeeId firstName lastName designation hireDate status annualCtc').sort({employeeId:1,_id:1}).skip((page-1)*limit).limit(limit).lean().exec(),
   this.employees.countDocuments(filter),
   this.employees.aggregate([{$match:filter},{$group:{_id:{$ifNull:['$status','Active']},count:{$sum:1}}}]),
  ]);
  return {columns:workforceColumns,rows:items.map(e=>({employeeCode:e.employeeId,name:[e.firstName,e.lastName].join(' '),designation:e.designation ?? null,hireDate:e.hireDate,status:e.status ?? 'Active',annualCtc:e.annualCtc})),total,page,limit,summary:{employees:total,...Object.fromEntries(statuses.map(s=>[s._id,s.count]))}};
 }
 async periods() {
  return this.runs.find({organizationId:tenantContext.getStore()?.organizationId ?? 'legacy',status:'Submitted'}).select('period idempotencyKey submittedAt additionalSubmissions.idempotencyKey additionalSubmissions.submittedAt').sort({period:-1}).lean().exec().then(runs=>runs.map(r=>({period:r.period,runs:[r.idempotencyKey,...(r.additionalSubmissions ?? []).map(s=>s.idempotencyKey)].filter(Boolean)})));
 }
 async payroll(period:string,query:Record<string,string>) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new BadRequestException('Select a valid payroll month (YYYY-MM).');
  const {page,limit}=reportPage(query);
  const run=await this.runs.findOne({organizationId:tenantContext.getStore()?.organizationId ?? 'legacy',period,status:'Submitted'}).select('-checks.pdf -additionalSubmissions.checks.pdf -pendingDraft').lean().exec();
  if(!run) throw new NotFoundException('No processed payroll exists for this month.');
  const report=payrollSnapshotReport(run);
  return {...report,period,total:report.rows.length,page,limit,rows:report.rows.slice((page-1)*limit,page*limit)};
 }
}
