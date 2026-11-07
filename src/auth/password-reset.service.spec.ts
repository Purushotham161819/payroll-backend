import { PasswordResetService } from './password-reset.service';
import { Model } from 'mongoose';
import { User } from './auth.schema';
import { EmailService } from './email.service';
it('returns the same response before any account lookup or delivery and processes requests serially', async () => {
  const service = new PasswordResetService(
    {} as Model<User>,
    {} as EmailService,
  );
  const work = jest
    .spyOn(service, 'request')
    .mockResolvedValue({ message: 'generic' });
  const known = service.enqueue('known@example.test');
  const unknown = service.enqueue('unknown@example.test');
  expect(known).toEqual(unknown);
  expect(work).not.toHaveBeenCalled();
  await new Promise((resolve) => setImmediate(resolve));
  expect(work.mock.calls).toEqual([
    ['known@example.test'],
    ['unknown@example.test'],
  ]);
});
