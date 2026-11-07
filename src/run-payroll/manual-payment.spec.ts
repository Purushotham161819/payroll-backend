import { RunPayrollService } from './run-payroll.service';
import { RunPayrollController } from './run-payroll.controller';
import { tenantContext } from '../organizations/tenant-context';
const employeeId = '507f1f77bcf86cd799439011';
function setup(additional = false, paid = false) {
 const check = {id: 'check', employeeId, ...(paid ? {paymentStatus: 'Paid'} : {})};
 const sub = { status: 'Submitted', idempotencyKey: 'second', checks: [check] };
 const run = {status: 'Submitted', checks: additional ? [] : [check], additionalSubmissions: additional ? [sub] : []};
 const runs = { findOne: jest.fn().mockReturnValue({lean: () => ({exec: async () => run})}), updateOne: jest.fn().mockResolvedValue({modifiedCount: 1}) };
 const service = new RunPayrollService(runs as any, null as any, null as any, null as any, null as any, null as any);
 return {service, runs};
}
describe('Manual payment persistence', () => {
 for (const additional of [false, true]) it('atomically updates only a pending check in the authenticated organization: additional=' + additional, async () => {
  const {service, runs} = setup(additional);
  await tenantContext.run({organizationId: 'org-a'}, () => service.markPaid('2026-11', employeeId, 'actor'));
  const [filter, update] = runs.updateOne.mock.calls[0];
  const path = additional ? 'additionalSubmissions.0.checks.0' : 'checks.0';
  expect(filter.organizationId).toBe('org-a');
  expect(filter[path + '.paymentStatus']).toEqual({$exists: false});
  expect(update.$set[path + '.paymentStatus']).toBe('Paid');
  expect(update.$set[path + '.paidBy']).toBe('actor');
  expect(update.$set[path + '.paidAt']).toBeInstanceOf(Date);
 });
 it('rejects duplicates and concurrent updates', async () => {
  const paid = setup(false, true);
  await expect(paid.service.markPaid('2026-11', employeeId, 'actor')).rejects.toThrow('already Paid');
  expect(paid.runs.updateOne).not.toHaveBeenCalled();
  const pending = setup(); pending.runs.updateOne.mockResolvedValue({modifiedCount: 0});
  await expect(pending.service.markPaid('2026-11', employeeId, 'actor')).rejects.toThrow('already Paid');
 });
 it('rejects unauthorized users before accessing persistence', () => {
  const {service, runs} = setup();
  expect(() => new RunPayrollController(service).markPaid('2026-11', employeeId, {account: {role: 'user', id: 'actor'}} as any)).toThrow('Administrator');
  expect(runs.findOne).not.toHaveBeenCalled();
 });
});
