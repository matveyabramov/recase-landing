<?php
declare(strict_types=1);

namespace Recase;

// PHPMailer lives outside public_html. The build installs an exact, checksum-verified release.
function createLeadMailer(array $message, array $smtp): \PHPMailer\PHPMailer\PHPMailer
{
    $library = __DIR__ . '/vendor/phpmailer/phpmailer/src/';
    foreach (['Exception.php', 'PHPMailer.php', 'SMTP.php'] as $file) {
        require_once $library . $file;
    }
    $mail = new \PHPMailer\PHPMailer\PHPMailer(true);
    $mail->isSMTP();
    $mail->SMTPDebug = 0;
    $mail->Host = $smtp['host'];
    $mail->Port = $smtp['port'];
    $mail->SMTPAuth = true;
    $mail->Username = $smtp['username'];
    $mail->Password = $smtp['password'];
    $mail->SMTPSecure = $smtp['encryption'] === 'smtps'
        ? \PHPMailer\PHPMailer\PHPMailer::ENCRYPTION_SMTPS
        : \PHPMailer\PHPMailer\PHPMailer::ENCRYPTION_STARTTLS;
    $mail->Timeout = 10;
    $mail->getSMTPInstance()->Timelimit = 15;
    $mail->SMTPKeepAlive = false;
    // Keep default certificate/hostname verification. Never allow self-signed TLS here.
    $mail->CharSet = 'UTF-8';
    $mail->Encoding = 'base64';
    $mail->isHTML(false);
    $mail->setFrom($smtp['from'], 'RE:CASE');
    $mail->addAddress($smtp['to']);
    // Applicant values only appear in the plain-text body, never in headers.
    $mail->Subject = $message['subject'];
    $mail->Body = $message['body'];
    $mail->XMailer = '';
    return $mail;
}

function sendLeadMail(array $message, array $smtp): bool
{
    return createLeadMailer($message, $smtp)->send(); // SMTP acceptance, not mailbox delivery.
}
