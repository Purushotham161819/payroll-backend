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
it('uses the employee welcome subject and portal description through the same email service', async () => {
  const send = jest.fn().mockResolvedValue({ status: 'accepted' });
  await new InvitationMail({ send } as unknown as EmailService).send('employee@example.test', 'Ada', 'Example', 'https://example.test/set-password#token=TEST', 24, true);
  const content = send.mock.calls[0][1];
  expect(content.subject).toBe('Welcome to PayStream \u2013 Set Up Your Employee Account');
  expect(content.text).toContain('Employee Portal'); expect(content.html).toContain('Pay Checks');
  expect(content.html).not.toContain('income tax/TDS');
  expect(content.html).toContain('24 hours'); expect(content.text).toContain('only be used once');
});
