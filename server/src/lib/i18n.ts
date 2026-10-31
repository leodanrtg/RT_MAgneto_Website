// Mensajes de la API en el idioma del panel. El código usa el texto en español como clave;
// la página manda su idioma en Accept-Language. Un texto sin traducción sale en español.
export const LANGS = ['es', 'en', 'pt', 'fr', 'de', 'it'] as const;
export type Lang = (typeof LANGS)[number];

export function pickLang(header: string | string[] | undefined): Lang {
  const first = String(Array.isArray(header) ? header[0] : header ?? '').split(',')[0].trim().toLowerCase().split('-')[0];
  return (LANGS as readonly string[]).includes(first) ? (first as Lang) : 'es';
}

type Row = [en: string, pt: string, fr: string, de: string, it: string];

const MESSAGES: Record<string, Row> = {
  // errores
  'Confirma tu correo antes de comprar.': ['Confirm your email before buying.', 'Confirme seu e-mail antes de comprar.', 'Confirmez votre e-mail avant d’acheter.', 'Bestätige deine E-Mail vor dem Kauf.', 'Conferma la tua email prima di acquistare.'],
  'Correo o contraseña incorrectos.': ['Incorrect email or password.', 'E-mail ou senha incorretos.', 'E-mail ou mot de passe incorrect.', 'E-Mail oder Passwort falsch.', 'Email o password errati.'],
  'Crea el plan en PayPal antes de activarlo.': ['Create the plan in PayPal before activating it.', 'Crie o plano no PayPal antes de ativá-lo.', 'Créez le plan dans PayPal avant de l’activer.', 'Lege den Plan in PayPal an, bevor du ihn aktivierst.', 'Crea il piano su PayPal prima di attivarlo.'],
  'Demasiados intentos fallidos. Espera unos minutos o recupera tu contraseña.': ['Too many failed attempts. Wait a few minutes or recover your password.', 'Muitas tentativas falharam. Aguarde alguns minutos ou recupere sua senha.', 'Trop de tentatives échouées. Patientez quelques minutes ou récupérez votre mot de passe.', 'Zu viele Fehlversuche. Warte einige Minuten oder setze dein Passwort zurück.', 'Troppi tentativi falliti. Attendi qualche minuto o recupera la password.'],
  'Demasiados intentos. Espera un momento.': ['Too many attempts. Please wait a moment.', 'Muitas tentativas. Aguarde um momento.', 'Trop de tentatives. Patientez un instant.', 'Zu viele Versuche. Bitte warte kurz.', 'Troppi tentativi. Attendi un momento.'],
  'El enlace no es válido o ya caducó.': ['The link is invalid or has expired.', 'O link não é válido ou já expirou.', 'Le lien n’est pas valide ou a expiré.', 'Der Link ist ungültig oder abgelaufen.', 'Il link non è valido o è scaduto.'],
  'Error interno. Inténtalo de nuevo.': ['Internal error. Please try again.', 'Erro interno. Tente novamente.', 'Erreur interne. Veuillez réessayer.', 'Interner Fehler. Bitte versuche es erneut.', 'Errore interno. Riprova.'],
  'Esta licencia depende de una suscripción: usa las acciones de la suscripción.': ['This license depends on a subscription: use the subscription actions.', 'Esta licença depende de uma assinatura: use as ações da assinatura.', 'Cette licence dépend d’un abonnement : utilisez les actions de l’abonnement.', 'Diese Lizenz hängt an einem Abo: Nutze die Aktionen des Abos.', 'Questa licenza dipende da un abbonamento: usa le azioni dell’abbonamento.'],
  'Esta licencia fue revocada.': ['This license was revoked.', 'Esta licença foi revogada.', 'Cette licence a été révoquée.', 'Diese Lizenz wurde widerrufen.', 'Questa licenza è stata revocata.'],
  'Esta suscripción no se puede cancelar.': ['This subscription cannot be canceled.', 'Esta assinatura não pode ser cancelada.', 'Cet abonnement ne peut pas être annulé.', 'Dieses Abo kann nicht gekündigt werden.', 'Questo abbonamento non può essere annullato.'],
  'Este cliente ya tiene una licencia viva de ese producto. Renuévala en lugar de crear otra.': ['This customer already has a live license for that product. Renew it instead of creating another one.', 'Este cliente já tem uma licença ativa desse produto. Renove-a em vez de criar outra.', 'Ce client a déjà une licence en cours pour ce produit. Renouvelez-la au lieu d’en créer une autre.', 'Dieser Kunde hat bereits eine gültige Lizenz für dieses Produkt. Verlängere sie, statt eine neue zu erstellen.', 'Questo cliente ha già una licenza valida per quel prodotto. Rinnovala invece di crearne un’altra.'],
  'Este plan ya existe en PayPal.': ['This plan already exists in PayPal.', 'Este plano já existe no PayPal.', 'Ce plan existe déjà dans PayPal.', 'Dieser Plan existiert bereits in PayPal.', 'Questo piano esiste già su PayPal.'],
  'Inicia sesión para continuar.': ['Sign in to continue.', 'Entre para continuar.', 'Connectez-vous pour continuer.', 'Melde dich an, um fortzufahren.', 'Accedi per continuare.'],
  'La clave todavía se está generando.': ['The key is still being generated.', 'A chave ainda está sendo gerada.', 'La clé est encore en cours de génération.', 'Der Schlüssel wird noch erzeugt.', 'La chiave è ancora in generazione.'],
  'La contraseña actual no es correcta.': ['The current password is incorrect.', 'A senha atual não está correta.', 'Le mot de passe actuel est incorrect.', 'Das aktuelle Passwort ist falsch.', 'La password attuale non è corretta.'],
  'La contraseña no es correcta.': ['The password is incorrect.', 'A senha não está correta.', 'Le mot de passe est incorrect.', 'Das Passwort ist falsch.', 'La password non è corretta.'],
  'La cuenta está suspendida.': ['The account is suspended.', 'A conta está suspensa.', 'Le compte est suspendu.', 'Das Konto ist gesperrt.', 'L’account è sospeso.'],
  'La licencia aún no se ha emitido.': ['The license has not been issued yet.', 'A licença ainda não foi emitida.', 'La licence n’a pas encore été émise.', 'Die Lizenz wurde noch nicht ausgestellt.', 'La licenza non è ancora stata emessa.'],
  'La licencia está revocada.': ['The license is revoked.', 'A licença está revogada.', 'La licence est révoquée.', 'Die Lizenz ist widerrufen.', 'La licenza è revocata.'],
  'La sesión caducó. Recarga la página.': ['Your session expired. Reload the page.', 'A sessão expirou. Recarregue a página.', 'La session a expiré. Rechargez la page.', 'Die Sitzung ist abgelaufen. Lade die Seite neu.', 'La sessione è scaduta. Ricarica la pagina.'],
  'No puedes cambiar el estado de tu propia cuenta.': ['You can’t change the status of your own account.', 'Você não pode alterar o status da sua própria conta.', 'Vous ne pouvez pas changer le statut de votre propre compte.', 'Du kannst den Status deines eigenen Kontos nicht ändern.', 'Non puoi cambiare lo stato del tuo account.'],
  'No puedes cambiar tu propio rol.': ['You can’t change your own role.', 'Você não pode alterar sua própria função.', 'Vous ne pouvez pas changer votre propre rôle.', 'Du kannst deine eigene Rolle nicht ändern.', 'Non puoi cambiare il tuo ruolo.'],
  'No tienes permiso para esta acción.': ['You don’t have permission for this action.', 'Você não tem permissão para esta ação.', 'Vous n’avez pas l’autorisation pour cette action.', 'Du hast keine Berechtigung für diese Aktion.', 'Non hai i permessi per questa azione.'],
  'Revisa los datos del formulario.': ['Check the form fields.', 'Verifique os dados do formulário.', 'Vérifiez les champs du formulaire.', 'Prüfe die Formulardaten.', 'Controlla i dati del modulo.'],
  'Solicitud no válida.': ['Invalid request.', 'Solicitação inválida.', 'Requête non valide.', 'Ungültige Anfrage.', 'Richiesta non valida.'],
  'Solo las licencias con suscripción se sincronizan.': ['Only subscription licenses are synced.', 'Só as licenças com assinatura são sincronizadas.', 'Seules les licences liées à un abonnement se synchronisent.', 'Nur Abo-Lizenzen werden synchronisiert.', 'Si sincronizzano solo le licenze con abbonamento.'],
  'Solo se reenvían claves de licencias activas.': ['Only keys of active licenses can be resent.', 'Só se reenviam chaves de licenças ativas.', 'Seules les clés des licences actives peuvent être renvoyées.', 'Nur Schlüssel aktiver Lizenzen können erneut gesendet werden.', 'Si reinviano solo le chiavi delle licenze attive.'],
  'Solo se reintentan tareas fallidas definitivamente.': ['Only permanently failed jobs can be retried.', 'Só se tentam novamente tarefas com falha definitiva.', 'Seules les tâches en échec définitif peuvent être relancées.', 'Nur endgültig fehlgeschlagene Aufgaben können wiederholt werden.', 'Si riprovano solo le attività fallite definitivamente.'],
  'Solo se reprocesan eventos fallidos.': ['Only failed events can be reprocessed.', 'Só se reprocessam eventos com falha.', 'Seuls les événements en échec peuvent être retraités.', 'Nur fehlgeschlagene Ereignisse können erneut verarbeitet werden.', 'Si rielaborano solo gli eventi falliti.'],
  'Tu cuenta está suspendida. Contacta con soporte.': ['Your account is suspended. Contact support.', 'Sua conta está suspensa. Fale com o suporte.', 'Votre compte est suspendu. Contactez le support.', 'Dein Konto ist gesperrt. Wende dich an den Support.', 'Il tuo account è sospeso. Contatta il supporto.'],
  'Ya existe un producto con ese identificador.': ['A product with that identifier already exists.', 'Já existe um produto com esse identificador.', 'Un produit avec cet identifiant existe déjà.', 'Ein Produkt mit dieser Kennung existiert bereits.', 'Esiste già un prodotto con questo identificativo.'],
  'Ya existe una cuenta con ese correo.': ['An account with that email already exists.', 'Já existe uma conta com esse e-mail.', 'Un compte avec cet e-mail existe déjà.', 'Ein Konto mit dieser E-Mail existiert bereits.', 'Esiste già un account con questa email.'],
  'Ya hay una tarea igual pendiente.': ['An identical job is already pending.', 'Já há uma tarefa igual pendente.', 'Une tâche identique est déjà en attente.', 'Eine gleiche Aufgabe steht bereits aus.', 'C’è già un’attività uguale in sospeso.'],
  'Ya tienes acceso a este producto hasta el final del periodo pagado. Podrás suscribirte de nuevo cuando termine.': ['You already have access to this product until the end of the paid period. You can subscribe again when it ends.', 'Você já tem acesso a este produto até o fim do período pago. Poderá assinar de novo quando terminar.', 'Vous avez déjà accès à ce produit jusqu’à la fin de la période payée. Vous pourrez vous réabonner ensuite.', 'Du hast bereits Zugang zu diesem Produkt bis zum Ende des bezahlten Zeitraums. Danach kannst du erneut abonnieren.', 'Hai già accesso a questo prodotto fino alla fine del periodo pagato. Potrai abbonarti di nuovo quando termina.'],
  'Ya tienes una suscripción a este producto.': ['You already have a subscription to this product.', 'Você já tem uma assinatura deste produto.', 'Vous avez déjà un abonnement à ce produit.', 'Du hast bereits ein Abo für dieses Produkt.', 'Hai già un abbonamento a questo prodotto.'],
  'No encontrado.': ['Not found.', 'Não encontrado.', 'Introuvable.', 'Nicht gefunden.', 'Non trovato.'],
  'Evento no encontrado.': ['Event not found.', 'Evento não encontrado.', 'Événement introuvable.', 'Ereignis nicht gefunden.', 'Evento non trovato.'],
  'Licencia no encontrada.': ['License not found.', 'Licença não encontrada.', 'Licence introuvable.', 'Lizenz nicht gefunden.', 'Licenza non trovata.'],
  'Plan no encontrado.': ['Plan not found.', 'Plano não encontrado.', 'Plan introuvable.', 'Plan nicht gefunden.', 'Piano non trovato.'],
  'Producto no encontrado.': ['Product not found.', 'Produto não encontrado.', 'Produit introuvable.', 'Produkt nicht gefunden.', 'Prodotto non trovato.'],
  'Suscripción no encontrada.': ['Subscription not found.', 'Assinatura não encontrada.', 'Abonnement introuvable.', 'Abonnement nicht gefunden.', 'Abbonamento non trovato.'],
  'Usuario no encontrado.': ['User not found.', 'Usuário não encontrado.', 'Utilisateur introuvable.', 'Benutzer nicht gefunden.', 'Utente non trovato.'],
  'Usuario o producto no encontrado.': ['User or product not found.', 'Usuário ou produto não encontrado.', 'Utilisateur ou produit introuvable.', 'Benutzer oder Produkt nicht gefunden.', 'Utente o prodotto non trovato.'],
  // validación de campos
  'Correo no válido': ['Invalid email', 'E-mail inválido', 'E-mail non valide', 'Ungültige E-Mail', 'Email non valida'],
  'Mínimo 10 caracteres': ['At least 10 characters', 'Mínimo de 10 caracteres', '10 caractères minimum', 'Mindestens 10 Zeichen', 'Almeno 10 caratteri'],
  // respuestas correctas
  'Contraseña actualizada. Ya puedes iniciar sesión.': ['Password updated. You can sign in now.', 'Senha atualizada. Você já pode entrar.', 'Mot de passe mis à jour. Vous pouvez vous connecter.', 'Passwort aktualisiert. Du kannst dich jetzt anmelden.', 'Password aggiornata. Ora puoi accedere.'],
  'Contraseña cambiada. Se cerraron tus otras sesiones.': ['Password changed. Your other sessions were closed.', 'Senha alterada. Suas outras sessões foram encerradas.', 'Mot de passe modifié. Vos autres sessions ont été fermées.', 'Passwort geändert. Deine anderen Sitzungen wurden beendet.', 'Password cambiata. Le altre sessioni sono state chiuse.'],
  'Correo confirmado.': ['Email confirmed.', 'E-mail confirmado.', 'E-mail confirmé.', 'E-Mail bestätigt.', 'Email confermata.'],
  'Correo enviado.': ['Email sent.', 'E-mail enviado.', 'E-mail envoyé.', 'E-Mail gesendet.', 'Email inviata.'],
  'Invitación enviada.': ['Invitation sent.', 'Convite enviado.', 'Invitation envoyée.', 'Einladung gesendet.', 'Invito inviato.'],
  'Sesión cerrada.': ['Signed out.', 'Sessão encerrada.', 'Session fermée.', 'Abgemeldet.', 'Sessione chiusa.'],
  'Si el correo está registrado, recibirás un enlace para restablecer la contraseña.': ['If the email is registered, you’ll receive a link to reset your password.', 'Se o e-mail estiver cadastrado, você receberá um link para redefinir a senha.', 'Si l’e-mail est enregistré, vous recevrez un lien pour réinitialiser le mot de passe.', 'Wenn die E-Mail registriert ist, erhältst du einen Link zum Zurücksetzen des Passworts.', 'Se l’email è registrata, riceverai un link per reimpostare la password.'],
  'Te enviamos un correo para confirmar tu dirección.': ['We sent you an email to confirm your address.', 'Enviamos um e-mail para confirmar seu endereço.', 'Nous vous avons envoyé un e-mail pour confirmer votre adresse.', 'Wir haben dir eine E-Mail zur Bestätigung deiner Adresse geschickt.', 'Ti abbiamo inviato un’email per confermare il tuo indirizzo.'],
};

const COLUMN: Record<Exclude<Lang, 'es'>, number> = { en: 0, pt: 1, fr: 2, de: 3, it: 4 };

export function translate(message: string, lang: Lang): string {
  if (lang === 'es') return message;
  return MESSAGES[message]?.[COLUMN[lang]] ?? message;
}

export const knownMessages = () => Object.keys(MESSAGES);
