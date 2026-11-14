export const itBugReport = {
  titles: {
    manual: 'Segnala un bug',
    error: 'Si è verificato un errore nel gioco',
    'sim-stall': 'Il gioco si è fermato',
    'main-freeze': 'Il gioco si è bloccato',
    'unclean-exit': 'Il gioco si è chiuso inaspettatamente',
    'renderer-gone': 'Il gioco si è arrestato in modo anomalo',
    'renderer-unresponsive': 'Il gioco non risponde più',
    desync: 'Il gioco ha perso la sincronizzazione',
    'context-lost': 'La grafica ha smesso di funzionare',
    'gpu-gone': 'La grafica è stata riavviata',
  },
  explanations: {
    manual: 'Descrivi cosa è andato storto. Leggiamo ogni segnalazione e ognuna aiuta a migliorare il gioco.',
    error:
      "Qualcosa nel gioco non ha funzionato. Il gioco può continuare, ma d'ora in poi potrebbe comportarsi in modo strano.",
    'sim-stall':
      'Il mondo ha smesso di muoversi. Può aiutare caricare un salvataggio o ricaricare la pagina.',
    'main-freeze': "La pagina non ha risposto per un po'.",
    'unclean-exit':
      "L'ultima partita non si è chiusa correttamente, probabilmente per un arresto anomalo o un blocco.",
    'renderer-gone': 'La pagina del gioco si è chiusa in modo anomalo ed è stata riavviata.',
    'renderer-unresponsive': "La pagina del gioco non ha risposto per un po'.",
    desync:
      'La tua partita non corrisponde più a quella degli altri giocatori, quindi non può proseguire in modo affidabile.',
    'context-lost':
      "Il browser ha tolto la grafica al gioco e non l'ha restituita. Ricarica la pagina; se non basta, chiudi del tutto il gioco o il browser e riavvialo.",
    'gpu-gone':
      'La parte grafica del gioco si è fermata ed è stata riavviata. Il gioco si è ripreso; la segnalazione aiuta a capire perché è successo.',
  },
  fatalTitle: 'Il gioco non può continuare',
  fatalExplanation:
    'Un errore ha fermato il gioco. Invia o scarica la segnalazione, poi ricarica la pagina. Dopo potrai caricare il tuo ultimo salvataggio.',
  reload: 'Ricarica',
  status: {
    preparing: 'Preparazione della segnalazione…',
    sending: 'Invio della segnalazione…',
    sent: 'Segnalazione inviata, n. {number}.',
    counted:
      "Questo problema è già noto: il server lo ha contato ma non ne ha conservato un'altra copia. Per darci altri dettagli, scrivi un commento e invialo come nuova segnalazione.",
    queued: 'Impossibile inviare la segnalazione. Il gioco riproverà più tardi.',
    full: 'Il server delle segnalazioni è pieno in questo momento. Scarica la segnalazione e inviala in un altro modo.',
    rejected: 'Il server non ha accettato la segnalazione. Scaricala e inviala in un altro modo.',
    unsupported: 'Questo browser non può inviare segnalazioni. Scarica invece la segnalazione.',
    expired: 'Impossibile inviare la segnalazione. Scaricala e inviala in un altro modo.',
    unsent: 'Non è stato ancora inviato nulla.',
    limited:
      'Questa segnalazione non è stata inviata automaticamente: il gioco ne ha già inviate abbastanza in questa sessione. Puoi inviarla tu.',
  },
  additionsHint: 'Puoi aggiungere un commento e altri file.',
  additions: {
    sending: 'Invio delle aggiunte…',
    sent: 'Grazie, le tue aggiunte sono state inviate.',
    queued: 'Impossibile inviare le aggiunte. Il gioco riproverà più tardi.',
    failed: 'Non è stato possibile inviare le aggiunte. Scarica invece la segnalazione.',
  },
  thanks: 'Grazie! La tua segnalazione n. {number} è arrivata.',
  more: {
    one: 'Da allora si è verificato {count} altro problema.',
    few: 'Da allora si sono verificati altri {count} problemi.',
    many: 'Da allora si sono verificati altri {count} problemi.',
  },
  comment: 'Commento (facoltativo)',
  commentPlaceholder: 'Cosa stavi facendo quando è successo?',
  description: 'Cosa è successo?',
  descriptionHint: 'È utile sapere cosa hai fatto, cosa ti aspettavi e cosa è successo invece.',
  descriptionRequired: 'Descrivi prima il problema.',
  countedNeedsWords: 'Scrivi prima un commento o un contatto; verrà inviato come nuova segnalazione.',
  alsoSendHeld: {
    one: 'Invia anche la segnalazione di {count} altro problema',
    few: 'Invia anche le segnalazioni di altri {count} problemi',
    many: 'Invia anche le segnalazioni di altri {count} problemi',
  },
  earlierError: {
    title: "L'ultima volta si è verificato un errore nel gioco",
    explanation:
      'Nella sessione precedente qualcosa nel gioco non ha funzionato. Da allora il gioco è ripartito e dovrebbe funzionare normalmente.',
  },
  earlierNote: 'È successo nella sessione precedente.',
  contact: 'Contatto (facoltativo)',
  contactPlaceholder: 'E-mail o nome Discord',
  contactHint: "Solo se vuoi una risposta. È l'unico dato personale nella segnalazione.",
  attachments: 'Allega',
  attachment: {
    commands: 'Registro dei comandi, per rigiocare la partita',
    settings: 'Impostazioni di gioco',
    screenshot: 'Screenshot',
    save: 'Ultimo salvataggio automatico',
  },
  shortened: "solo l'ultima parte",
  included: 'già inviato',
  large: 'file grande',
  overCap: 'Troppo grande insieme agli altri file.',
  preview: 'Mostra cosa viene inviato',
  send: 'Invia',
  sendAdditions: 'Invia aggiunte',
  download: 'Scarica',
  close: 'Chiudi',
  privacy:
    'La segnalazione contiene dati tecnici sul gioco e sul tuo computer, oltre a ciò che scrivi qui. Il tuo indirizzo IP non viene salvato.',
  sizeKb: '{size} KB',
  sizeMb: '{size} MB',
} as const;
