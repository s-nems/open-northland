export const deBugReport = {
  titles: {
    manual: 'Fehler melden',
    error: 'Im Spiel ist ein Fehler aufgetreten',
    'sim-stall': 'Das Spiel ist stehen geblieben',
    'main-freeze': 'Das Spiel ist eingefroren',
    'unclean-exit': 'Das Spiel wurde unerwartet beendet',
    'renderer-gone': 'Das Spiel ist abgestürzt',
    'renderer-unresponsive': 'Das Spiel reagiert nicht mehr',
    desync: 'Das Spiel ist nicht mehr synchron',
    'context-lost': 'Die Grafik funktioniert nicht mehr',
    'gpu-gone': 'Die Grafik wurde neu gestartet',
  },
  explanations: {
    manual:
      'Beschreibe, was schiefgelaufen ist. Jeder Bericht wird gelesen und hilft, das Spiel zu verbessern.',
    error:
      'Ein Teil des Spiels ist fehlgeschlagen. Es läuft vielleicht weiter, kann sich ab jetzt aber seltsam verhalten.',
    'sim-stall': 'Die Welt bewegt sich nicht mehr. Einen Spielstand oder die Seite neu zu laden kann helfen.',
    'main-freeze': 'Die Seite hat eine Weile nicht reagiert.',
    'unclean-exit':
      'Dein letztes Spiel wurde nicht richtig beendet, vermutlich wegen eines Absturzes oder Einfrierens.',
    'renderer-gone': 'Die Spielseite ist abgestürzt und wurde neu gestartet.',
    'renderer-unresponsive': 'Die Spielseite hat eine Weile nicht reagiert.',
    desync:
      'Dein Spiel stimmt nicht mehr mit denen der anderen Spieler überein, daher kann die Partie nicht zuverlässig weiterlaufen.',
    'context-lost':
      'Der Browser hat dem Spiel die Grafik entzogen und nicht zurückgegeben. Lade die Seite neu; hilft das nicht, beende das Spiel oder den Browser vollständig und starte erneut.',
    'gpu-gone':
      'Der Grafikteil des Spiels ist ausgefallen und wurde neu gestartet. Das Spiel läuft wieder; der Bericht hilft, die Ursache zu finden.',
  },
  fatalTitle: 'Das Spiel kann nicht weiterlaufen',
  fatalExplanation:
    'Ein Fehler hat das Spiel angehalten. Sende den Bericht oder lade ihn herunter und lade dann die Seite neu. Danach kannst du deinen letzten Spielstand laden.',
  reload: 'Neu laden',
  status: {
    preparing: 'Bericht wird vorbereitet…',
    sending: 'Bericht wird gesendet…',
    sent: 'Bericht gesendet, Nr. {number}.',
    counted:
      'Dieses Problem ist bereits bekannt: Der Server hat es gezählt, aber keine weitere Kopie behalten. Wenn du mehr dazu sagen möchtest, schreibe einen Kommentar und sende ihn als neuen Bericht.',
    queued: 'Der Bericht konnte nicht gesendet werden. Das Spiel versucht es später erneut.',
    full: 'Der Berichtsserver ist gerade voll. Bitte lade den Bericht herunter und schicke ihn auf anderem Weg.',
    rejected:
      'Der Server hat den Bericht nicht angenommen. Bitte lade ihn herunter und schicke ihn auf anderem Weg.',
    unsupported: 'Dieser Browser kann keine Berichte senden. Bitte lade den Bericht stattdessen herunter.',
    expired:
      'Der Bericht konnte nicht gesendet werden. Bitte lade ihn herunter und schicke ihn auf anderem Weg.',
    unsent: 'Es wurde noch nichts gesendet.',
    limited:
      'Dieser Bericht wurde nicht automatisch gesendet, weil das Spiel in dieser Sitzung schon genug davon gesendet hat. Du kannst ihn selbst senden.',
  },
  additionsHint: 'Du kannst einen Kommentar und weitere Dateien hinzufügen.',
  additions: {
    sending: 'Ergänzungen werden gesendet…',
    sent: 'Danke, deine Ergänzungen wurden gesendet.',
    queued: 'Die Ergänzungen konnten nicht gesendet werden. Das Spiel versucht es später erneut.',
    failed: 'Die Ergänzungen konnten nicht gesendet werden. Bitte lade den Bericht stattdessen herunter.',
  },
  thanks: 'Danke! Dein Bericht Nr. {number} ist angekommen.',
  more: {
    one: 'Seitdem ist {count} weiteres Problem aufgetreten.',
    few: 'Seitdem sind {count} weitere Probleme aufgetreten.',
    many: 'Seitdem sind {count} weitere Probleme aufgetreten.',
  },
  comment: 'Kommentar (optional)',
  commentPlaceholder: 'Was hast du gerade gemacht, als es passiert ist?',
  description: 'Was ist passiert?',
  descriptionHint: 'Hilfreich ist: was du getan hast, was du erwartet hast und was stattdessen passiert ist.',
  descriptionRequired: 'Bitte beschreibe zuerst das Problem.',
  countedNeedsWords:
    'Schreibe zuerst einen Kommentar oder gib einen Kontakt an; er wird als neuer Bericht gesendet.',
  alsoSendHeld: {
    one: 'Auch den Bericht zu {count} weiteren Problem senden',
    few: 'Auch die Berichte zu {count} weiteren Problemen senden',
    many: 'Auch die Berichte zu {count} weiteren Problemen senden',
  },
  earlierError: {
    title: 'Beim letzten Mal ist ein Fehler aufgetreten',
    explanation:
      'In deiner letzten Sitzung ist ein Teil des Spiels fehlgeschlagen. Das Spiel wurde seitdem neu gestartet und sollte normal laufen.',
  },
  earlierNote: 'Das ist in deiner letzten Sitzung passiert.',
  contact: 'Kontakt (optional)',
  contactPlaceholder: 'E-Mail oder Discord-Name',
  contactHint: 'Nur wenn du eine Antwort möchtest. Das sind die einzigen persönlichen Daten im Bericht.',
  attachments: 'Anhängen',
  attachment: {
    commands: 'Befehlsprotokoll zum Nachspielen der Partie',
    settings: 'Spieleinstellungen',
    screenshot: 'Bildschirmfoto',
    save: 'Neueste automatische Speicherung',
  },
  shortened: 'nur der letzte Teil',
  included: 'bereits gesendet',
  large: 'große Datei',
  overCap: 'Zusammen mit den anderen Dateien zu groß.',
  preview: 'Anzeigen, was gesendet wird',
  send: 'Senden',
  sendAdditions: 'Ergänzungen senden',
  download: 'Herunterladen',
  close: 'Schließen',
  privacy:
    'Der Bericht enthält technische Daten über das Spiel und deinen Computer sowie das, was du hier schreibst. Deine IP-Adresse wird nicht gespeichert.',
  sizeKb: '{size} KB',
  sizeMb: '{size} MB',
} as const;
