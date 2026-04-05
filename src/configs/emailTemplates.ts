import { APIError } from 'better-auth/api';
import { sendEmail } from './emails';

const emailTemplates = {
  sendPasswordResetEmail: async (
    to: string,
    data: {
      name: string; // User's name
      resetLink: string; // Secure one-time reset password link
      expiresIn?: string; // e.g. "1 hour", "24 hours"
    }
  ): Promise<boolean> => {
    const preheader = `Reset your Finager India password – quick & secure`;

    const html = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <meta http-equiv="X-UA-Compatible" content="IE=edge">
          <title>Reset Your Password – Finager India</title>
        
          <style type="text/css">
            body { margin:0; padding:0; background-color:#f4f4f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
            table, td { border-collapse: collapse; }
            img { border:0; height:auto; line-height:100%; outline:none; text-decoration:none; }
            a { color:#4f46e5; text-decoration:none; }
          </style>
        </head>
        <body style="margin:0; padding:0; background-color:#f4f4f9;">
        
          <!-- Preheader -->
          <div style="display:none; font-size:1px; color:#f4f4f9; line-height:1px; max-height:0px; max-width:0px; opacity:0; overflow:hidden;">
            ${preheader}
          </div>
        
          <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color:#f4f4f9; padding:40px 0;">
            <tr>
              <td align="center">
                <!-- Main Container -->
                <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width:600px; background-color:#ffffff; border-radius:12px; overflow:hidden; box-shadow:0 4px 20px rgba(0,0,0,0.08);">
        
                  <!-- Header -->
                  <tr>
                    <td style="padding:32px 40px 20px; background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%); text-align:center;">
                      <img src="https://www.finagerindia.com/logo.png" 
                           alt="Finager India" 
                           style="max-width:180px; height:auto; margin-bottom:16px;" />
                      <h1 style="margin:0; font-size:28px; font-weight:600; color:#ffffff;">
                        Reset Your Password
                      </h1>
                      <p style="margin:12px 0 0; font-size:16px; color:#ffffff; opacity:0.9;">
                        Quick & secure recovery for your Finager India account
                      </p>
                    </td>
                  </tr>
        
                  <!-- Main Content -->
                  <tr>
                    <td style="padding:40px 40px 32px; font-size:16px; line-height:1.6; color:#1f2937;">
                      <p style="margin:0 0 24px;">Hello ${data.name},</p>
        
                      <p style="margin:0 0 24px;">
                        We received a request to reset the password for your Finager India account.
                      </p>
        
                      <p style="margin:0 0 32px;">
                        Click the button below to set a new password. This link is valid for a limited time only.
                      </p>
        
                      <!-- Big CTA Button -->
                      <table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin:0 auto 32px;">
                        <tr>
                          <td style="border-radius:8px; background-color:#4f46e5;">
                            <a href="${data.resetLink}" 
                               target="_blank" 
                               style="display:inline-block; padding:16px 56px; font-size:18px; font-weight:600; color:#ffffff; text-decoration:none;">
                              Reset Password →
                            </a>
                          </td>
                        </tr>
                      </table>
        
                      <!-- Fallback link -->
                      <p style="margin:0 0 24px; font-size:14px; color:#6b7280; text-align:center;">
                        Or copy and paste this link into your browser:<br>
                        <a href="${data.resetLink}" style="color:#4f46e5; word-break:break-all;">${data.resetLink}</a>
                      </p>
        
                      <!-- Expiry notice -->
                      ${
                        data.expiresIn
                          ? `
                        <p style="margin:0 0 24px; font-size:14px; color:#6b7280; text-align:center;">
                          This reset link expires in <strong>${data.expiresIn}</strong>.
                        </p>
                      `
                          : ''
                      }
        
                      <p style="margin:0 0 16px; font-size:14px; color:#6b7280; text-align:center;">
                        If you didn’t request a password reset, you can safely ignore this email — your account is still secure.
                      </p>
        
                      <p style="margin:0; font-size:14px; color:#6b7280; text-align:center;">
                        For help, contact us at <a href="mailto:support@finagerindia.com">support@finagerindia.com</a>
                      </p>
                    </td>
                  </tr>
        
                  <!-- Footer -->
                  <tr>
                    <td style="padding:32px 40px; background-color:#f8f9fa; text-align:center; font-size:14px; color:#6b7280; border-top:1px solid #e5e7eb;">
                      <p style="margin:0 0 8px;">
                        <strong>Finager India</strong><br>
                        <a href="https://www.finagerindia.com" style="color:#4f46e5;">www.finagerindia.com</a>
                      </p>
                      <p style="margin:12px 0 0;">
                        <a href="https://www.finagerindia.com/support" style="color:#4f46e5;">Help & Support</a> • 
                        <a href="https://www.finagerindia.com/privacy" style="color:#4f46e5;">Privacy Policy</a>
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
        </html>
          `;

    const text = `
        Reset Your Password – Finager India
        
        Hello ${data.name},
        
        We received a request to reset your Finager India account password.
        
        Click here to set a new password: ${data.resetLink}
        
        ${data.expiresIn ? `This link expires in ${data.expiresIn}.` : ''}
        
        If you didn’t request this reset, please ignore this email — your account remains secure.
        
        For assistance, contact support@finagerindia.com
        
        Best regards,
        Finager India Team
        https://www.finagerindia.com
          `.trim();

    return await sendEmail({
      to,
      subject: `Reset Your Password – Finager India`,
      html,
      text,
    });
  },
  sendVerificationEmail: async (
    origin: string,
    to: string,
    data: {
      name: string;
      verificationLink: string;
      token: string;
      expiresIn?: string; // e.g. "24 hours", "7 days"
    }
  ): Promise<boolean> => {
    const preheader = `Verify your Finager India account – quick action needed`;

    const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <meta http-equiv="X-UA-Compatible" content="IE=edge">
      <title>Verify Your Email – Finager India</title>
    
      <style type="text/css">
        body { margin:0; padding:0; background-color:#f4f4f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
        table, td { border-collapse: collapse; }
        img { border:0; height:auto; line-height:100%; outline:none; text-decoration:none; }
        a { color:#4f46e5; text-decoration:none; }
      </style>
    </head>
    <body style="margin:0; padding:0; background-color:#f4f4f9;">
    
      <!-- Preheader (hidden preview text) -->
      <div style="display:none; font-size:1px; color:#f4f4f9; line-height:1px; max-height:0px; max-width:0px; opacity:0; overflow:hidden;">
        ${preheader}
      </div>
    
      <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color:#f4f4f9; padding:40px 0;">
        <tr>
          <td align="center">
            <!-- Main Container -->
            <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width:600px; background-color:#ffffff; border-radius:12px; overflow:hidden; box-shadow:0 4px 20px rgba(0,0,0,0.08);">
    
              <!-- Header with Logo & Gradient -->
              <tr>
                <td style="padding:32px 40px 20px; background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%); text-align:center;">
                  <!-- Logo -->
                  <img src="https://www.finagerindia.com/logo.png" 
                       alt="Finager India" 
                       style="max-width:180px; height:auto; margin-bottom:16px;" />
                  <h1 style="margin:0; font-size:28px; font-weight:600; color:#ffffff;">
                    Verify Your Email
                  </h1>
                  <p style="margin:12px 0 0; font-size:16px; color:#ffffff; opacity:0.9;">
                    Complete your Finager India setup
                  </p>
                </td>
              </tr>
    
              <!-- Main Content -->
              <tr>
                <td style="padding:40px 40px 32px; font-size:16px; line-height:1.6; color:#1f2937;">
                  <p style="margin:0 0 24px;">Hello ${data.name},</p>
    
                  <p style="margin:0 0 24px;">
                    Thank you for signing up with <strong>Finager India</strong>.
                  </p>
    
                  <p style="margin:0 0 32px;">
                    To activate your account and start managing your finances securely, please verify your email address by clicking the button below.
                  </p>
    
                  <!-- CTA Button -->
                  <table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin:0 auto 32px;">
                    <tr>
                      <td style="border-radius:8px; background-color:#4f46e5;">
                        <a href="${origin}/auth/emailVerified?token=${data.token}" 
                           target="_blank" 
                           style="display:inline-block; padding:16px 56px; font-size:18px; font-weight:600; color:#ffffff; text-decoration:none;">
                          Verify My Email →
                        </a>
                      </td>
                    </tr>
                  </table>
    
                  <!-- Fallback link -->
                  <p style="margin:0 0 24px; font-size:14px; color:#6b7280; text-align:center;">
                    Or copy and paste this link into your browser:<br>
                    <a href="${origin}/auth/emailVerified?token=${data.token}" style="color:#4f46e5; word-break:break-all;">${origin}/auth/emailVerified?token=${data.token}</a>
                  </p>
    
                  <!-- Expiry notice -->
                  ${
                    data.expiresIn
                      ? `
                    <p style="margin:0 0 24px; font-size:14px; color:#6b7280; text-align:center;">
                      This verification link expires in <strong>${data.expiresIn}</strong>.
                    </p>
                  `
                      : ''
                  }
    
                  <p style="margin:0; font-size:14px; color:#6b7280; text-align:center;">
                    If you didn’t create an account with Finager India, you can safely ignore this email.
                  </p>
                </td>
              </tr>
    
              <!-- Footer -->
              <tr>
                <td style="padding:32px 40px; background-color:#f8f9fa; text-align:center; font-size:14px; color:#6b7280; border-top:1px solid #e5e7eb;">
                  <p style="margin:0 0 8px;">
                    <strong>Finager India</strong><br>
                    <a href="https://www.finagerindia.com" style="color:#4f46e5;">www.finagerindia.com</a>
                  </p>
                  <p style="margin:12px 0 0;">
                    <a href="https://www.finagerindia.com/support" style="color:#4f46e5;">Help & Support</a> • 
                    <a href="https://www.finagerindia.com/privacy" style="color:#4f46e5;">Privacy Policy</a>
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
      `;

    const text = `
    Verify Your Email – Finager India
    
    Hello ${data.name},
    
    Thank you for signing up with Finager India.
    
    To activate your account and start managing your finances securely, please verify your email address:
    
    ${data.verificationLink}
    
    ${data.expiresIn ? `This link expires in ${data.expiresIn}.` : ''}
    
    If you didn’t create an account, please ignore this email.
    
    Best regards,
    Finager India Team
    https://www.finagerindia.com
      `.trim();

    return sendEmail({
      to,
      subject: `Verify Your Email – Finager India`,
      html,
      text,
    });
  },
  sendOrganizationInvitationEmail: async (
    to: string,
    data: {
      invitedByUsername: string;
      invitedByEmail: string;
      teamName: string; // e.g. "Trendy Threads" or "Rajesh CA & Associates"
      inviteLink: string;
      organizationName?: string;
      expiryDays?: number; // default 7
    }
  ): Promise<boolean> => {
    // Validate the data
    if (
      !data.invitedByUsername ||
      !data.invitedByEmail ||
      !data.teamName ||
      !data.inviteLink
    ) {
      throw new APIError({
        STATUS: 400,
        TITLE: 'INVALID_DATA',
        MESSAGE: 'Invalid data',
      });
    }
    const organizationDisplay = data.organizationName || data.teamName;
    const preheader = `Invitation to join ${organizationDisplay} on Finager India`;

    const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <title>Invitation to Join ${organizationDisplay} – Finager India</title>
    
    <style type="text/css">
      /* Reset styles */
      body { margin:0; padding:0; background-color:#f4f4f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
      table, td { border-collapse: collapse; }
      img { border:0; height:auto; line-height:100%; outline:none; text-decoration:none; }
      a { color:#4f46e5; text-decoration:none; }
    </style>
    </head>
    <body style="margin:0; padding:0; background-color:#f4f4f9;">
    
    <!-- Preheader -->
    <div style="display:none; font-size:1px; color:#f4f4f9; line-height:1px; max-height:0px; max-width:0px; opacity:0; overflow:hidden;">
      ${preheader} – Action required
    </div>
    
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color:#f4f4f9; padding:40px 0;">
      <tr>
      <td align="center">
        <!-- Main Container -->
        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width:600px; background-color:#ffffff; border-radius:12px; overflow:hidden; box-shadow:0 4px 20px rgba(0,0,0,0.08);">
    
        <!-- Header with Logo & Gradient -->
        <tr>
          <td style="padding:32px 40px 20px; background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%); text-align:center;">
          <!-- Logo placeholder – replace src with your actual logo URL -->
          <img src="https://www.finagerindia.com/logo.png" 
             alt="Finager India" 
             style="max-width:180px; height:auto; margin-bottom:16px;" />
          <h1 style="margin:0; font-size:28px; font-weight:600; color:#ffffff;">
            You're Invited!
          </h1>
          <p style="margin:12px 0 0; font-size:16px; color:#ffffff; opacity:0.9;">
            to join <strong>${organizationDisplay}</strong> on Finager India
          </p>
          </td>
        </tr>
    
        <!-- Main Content -->
        <tr>
          <td style="padding:40px 40px 32px; font-size:16px; line-height:1.6; color:#1f2937;">
          <p style="margin:0 0 24px;">Hello,</p>
    
          <p style="margin:0 0 24px;">
            <strong>${data.invitedByUsername}</strong> (${data.invitedByEmail}) has invited you to join 
            <strong>${organizationDisplay}</strong> as a team member on <strong>Finager India</strong>.
          </p>
    
          <p style="margin:0 0 32px;">
            Collaborate on real-time billing, inventory, accounting, and GST compliance — all in one secure platform. 
            No more file chasing or manual data entry.
          </p>
    
          <!-- Big CTA Button -->
          <table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin:0 auto 32px;">
            <tr>
            <td style="border-radius:8px; background-color:#4f46e5;">
              <a href="${data.inviteLink}" 
               target="_blank" 
               style="display:inline-block; padding:16px 56px; font-size:18px; font-weight:600; color:#ffffff; text-decoration:none;">
              Accept Invitation →
              </a>
            </td>
            </tr>
          </table>
    
          <p style="margin:0 0 16px; font-size:14px; color:#6b7280; text-align:center;">
            This invitation expires in <strong>${data.expiryDays || 7} days</strong>.
          </p>
    
          <p style="margin:0; font-size:14px; color:#6b7280; text-align:center;">
            If you weren’t expecting this invitation, feel free to ignore this email or contact support.
          </p>
          </td>
        </tr>
    
        <!-- Footer -->
        <tr>
          <td style="padding:32px 40px; background-color:#f8f9fa; text-align:center; font-size:14px; color:#6b7280; border-top:1px solid #e5e7eb;">
          <p style="margin:0 0 8px;">
            <strong>Finager India</strong><br>
            <a href="https://www.finagerindia.com" style="color:#4f46e5;">www.finagerindia.com</a>
          </p>
          <p style="margin:12px 0 0;">
            <a href="https://www.finagerindia.com/support" style="color:#4f46e5;">Help & Support</a> • 
            <a href="https://www.finagerindia.com/privacy" style="color:#4f46e5;">Privacy Policy</a>
          </p>
          </td>
        </tr>
        </table>
      </td>
      </tr>
    </table>
    </body>
    </html>
    `;

    return sendEmail({
      to,
      subject: `Invitation to join ${organizationDisplay} on Finager India`,
      html,
      text: `Hello,
    
    ${data.invitedByUsername} (${data.invitedByEmail}) has invited you to join ${organizationDisplay} on Finager India.
    
    Click here to accept the invitation: ${data.inviteLink}
    
    This link expires in ${data.expiryDays || 7} days.
    
    Best regards,
    Finager India Team
    https://www.finagerindia.com`,
    });
  },
};

export default emailTemplates;
