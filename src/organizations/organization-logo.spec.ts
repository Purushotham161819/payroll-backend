import { validateLogo } from './organization-logo';
import { PlatformService } from './platform.service';
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAADUlEQVR4XmP4z8AARAAI/gH/egE/eAAAAABJRU5ErkJggg==';
describe('Organization logo storage validation', () => {
 it('accepts PNG and rejects spoofed, corrupt and oversized images', () => {
  expect(validateLogo(png)).toBe(png);
  for (const value of ['data:image/svg+xml;base64,AAAA', 'data:image/jpeg;base64,AAAA', png.replace('png','jpeg'), 'data:image/png;base64,' + Buffer.alloc(2097153).toString('base64')]) expect(() => validateLogo(value)).toThrow();
 });
 it('isolates upload, replacement and removal to the administrator organization', async () => {
  const collection = {findOne: jest.fn().mockResolvedValue({name:'A', status:'active'}), updateOne: jest.fn().mockResolvedValue({matchedCount:1})};
  const users = {db:{collection:()=>collection}, findById:jest.fn().mockResolvedValue({active:true,role:'admin',organizationId:'a'})};
  const service = new PlatformService(users as any, null as any);
  await service.saveOrganizationLogo('a','actor',png);
  expect(collection.updateOne.mock.calls[0][0]).toEqual({organizationId:'a',status:'active'});
  expect(collection.updateOne.mock.calls[0][1].$set.logo).toBe(png);
  await service.saveOrganizationLogo('a','actor','');
  expect(collection.updateOne.mock.calls[1][1].$set.logo).toBeNull();
  await expect(service.saveOrganizationLogo('b','actor',png)).rejects.toThrow('Administrator');
  expect(collection.updateOne).toHaveBeenCalledTimes(2);
 });
});
