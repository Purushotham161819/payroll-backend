import { Injectable } from '@nestjs/common';
import { EmailService } from './email.service';

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        char
      ]!,
  );
export function invitationEmail(
  firstName: string,
  lastName: string,
  url: string,
  hours: number,
) {
  const fullName = escapeHtml(`${firstName} ${lastName}`.trim());
  const link = escapeHtml(url);
  return {
    subject: 'Welcome to PayStream \u2013 Set Up Your Account',
    text: `Hello ${firstName} ${lastName},\n\nWelcome to PayStream! Your account has been created. Set your password using this secure link:\n${url}\n\nThis invitation expires in ${hours} hours and can only be used once. After setup, sign in to access your assigned features. If you were not expecting this invitation, contact your organization administrator.\n\nPayStream Team\nAn Excelhire Product`,
    html: `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta charset="utf-8"><title>Welcome to PayStream</title></head><body style="margin:0;padding:0;background:#f4f6f2;font-family:Inter,'Segoe UI',Arial,sans-serif;color:#16261f"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:32px 16px"><table role="presentation" width="560" cellspacing="0" cellpadding="0" style="width:100%;max-width:560px;background:#ffffff;border:1px solid #e3e8e2;border-radius:12px"><tr><td style="padding:24px 28px;background:#12292b;color:#e4ece6"><strong style="font-size:22px;color:#c6eba6">PayStream</strong><br><span style="font-size:12px">An Excelhire Product</span></td></tr><tr><td style="padding:28px"><h1 style="margin:0 0 24px;font-size:24px;line-height:32px">Welcome to PayStream!</h1><p style="font-size:14px;line-height:22px">Hello ${fullName},</p><p style="font-size:14px;line-height:22px">Your account has been created successfully. We are pleased to have you on board.</p><p style="font-size:14px;line-height:22px">To get started, set up your password using the secure link below.</p><table role="presentation" cellspacing="0" cellpadding="0" style="margin:24px 0"><tr><td bgcolor="#1f4a3a" style="border-radius:6px;text-align:center"><a href="${link}" style="display:inline-block;padding:14px 24px;border:1px solid #1f4a3a;border-radius:6px;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;mso-padding-alt:14px 24px">Set Your Password</a></td></tr></table><p style="font-size:13px;line-height:20px;color:#5b6660">For your security, this invitation is valid for ${hours} hours and can only be used once.</p><p style="font-size:14px;line-height:22px">Once your password is set, sign in to PayStream to access the features assigned to your account.</p><p style="font-size:13px;line-height:20px;color:#5b6660">If the button does not work, copy this link into your browser:</p><p style="font-size:12px;line-height:20px;word-break:break-all"><a href="${link}" style="color:#1f4a3a">${link}</a></p><p style="font-size:13px;line-height:20px;color:#5b6660">If you were not expecting this invitation, please contact your organization administrator.</p><p style="margin:24px 0 0;font-size:14px;line-height:22px">Best regards,<br><strong>PayStream Team</strong></p></td></tr><tr><td style="padding:20px 28px;border-top:1px solid #e3e8e2;color:#5b6660;font-size:12px">PayStream &middot; An Excelhire Product</td></tr></table></td></tr></table></body></html>`,
  };
}

@Injectable()
export class InvitationMail {
  constructor(private readonly email: EmailService) {}
  async send(
    to: string,
    firstName: string,
    lastName: string,
    url: string,
    hours: number,
  ) {
    await this.email.send(to, invitationEmail(firstName, lastName, url, hours));
  }
}
