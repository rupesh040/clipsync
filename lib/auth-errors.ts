export function authFailureMessage(error:unknown){
  const details=error&&typeof error==='object'?error as {code?:string;status?:number}:{};
  if(details.status===429||details.code==='over_email_send_rate_limit')return 'Supabase email rate limit reached. Stop retrying until the window resets, or configure a production SMTP provider in Supabase.';
  if(details.code==='email_address_not_authorized')return 'Supabase’s built-in mailer can only send to project-team addresses. Configure custom SMTP for other users.';
  if(details.code==='otp_expired')return 'This email code expired or was already used. Request a fresh code.';
  return 'Sign-in could not complete. Check email delivery, SMTP, the numeric-code template, and your network connection.';
}
