import { InvitationMail, invitationEmail } from './invitation-mail';
import { EmailService } from './email.service';
it('routes the existing branded invitation through the centralized service', async () => {
  const send = jest.fn().mockResolvedValue({ status: 'accepted' });
  await new InvitationMail({ send } as unknown as EmailService).send(
    'user@example.test',
    'Asha',
    'Rao',
    'https://example.test/set-password#token=TEST',
    24,
  );
  expect(send).toHaveBeenCalledWith(
    'user@example.test',
    invitationEmail(
      'Asha',
      'Rao',
      'https://example.test/set-password#token=TEST',
      24,
    ),
  );
  expect(send.mock.calls[0][1].html).toContain('Set Your Password');
});
