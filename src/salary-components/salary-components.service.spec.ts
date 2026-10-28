import { SalaryComponentsService } from './salary-components.service';
import { Types } from 'mongoose';
import { CreateSalaryComponentDto } from './salary-component.dto';
describe('Salary configuration graph validation', () => {
  const a = new Types.ObjectId(), b = new Types.ObjectId();
  const dto = (): CreateSalaryComponentDto => ({name:'Basic',code:'CUSTOM',category:'earning',calculationBaseType:'annual_ctc',calculationType:'percentage',calculationValue:40,showInPayslip:true,status:'active'});
  function setup(records: any[]) {
    const model: any = { find: () => ({lean: () => ({exec: async () => records})}), findById: (id: string) => ({exec: async () => {const record = records.find(r => r._id.toString() === id); return record ? {...record,toObject:()=>record,set:jest.fn(),save:jest.fn().mockResolvedValue(record)} : null;}}), create: jest.fn().mockImplementation(async v => v) };
    return { model, service: new SalaryComponentsService(model) };
  }
  it('rejects missing, self and indirect bases', async () => {
    const {service} = setup([{...dto(),_id:a},{...dto(),_id:b,calculationBaseType:'salary_component',calculationBaseComponentId:a}]);
    await expect(service.create({...dto(),calculationBaseType:'salary_component',calculationBaseComponentId:new Types.ObjectId().toString()})).rejects.toThrow('does not exist');
    for (const id of [a,b]) await expect(service.update(a.toString(),{calculationBaseType:'salary_component',calculationBaseComponentId:id.toString()})).rejects.toThrow('Circular');
  });
  it('prevents deactivation of a referenced active base', async () => {
    const {service} = setup([{...dto(),_id:a},{...dto(),_id:b,calculationBaseType:'salary_component',calculationBaseComponentId:a}]);
    await expect(service.update(a.toString(),{status:'inactive'})).rejects.toThrow('active bases');
  });
  it('returns conflict for the database unique code constraint', async () => {
    const {model, service} = setup([]); model.create.mockRejectedValue({code:11000});
    await expect(service.create(dto())).rejects.toThrow('code already exists');
  });
  it('rejects percentages above 100 and missing fixed periods', async () => {
    const {service} = setup([]);
    await expect(service.create({...dto(),calculationValue:101})).rejects.toThrow('between');
    await expect(service.create({...dto(),calculationType:'fixed'})).rejects.toThrow('period');
  });
});

