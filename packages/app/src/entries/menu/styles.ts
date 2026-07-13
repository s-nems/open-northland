const MENU_CSS = `
  :root { color-scheme: dark; }
  body { margin:0; background:#090d0b; color:#f5edda; overflow:auto; }
  .on-menu { position:fixed; inset:0; z-index:100; overflow-y:auto; min-height:100vh;
    font:14px/1.5 Inter,ui-sans-serif,system-ui,sans-serif;
    background:
      radial-gradient(circle at 78% 7%,rgba(180,119,46,.20),transparent 28rem),
      radial-gradient(circle at 10% 42%,rgba(39,101,79,.23),transparent 32rem),
      linear-gradient(145deg,#0c1310 0%,#10110e 55%,#171108 100%); }
  .on-menu::before { content:""; position:fixed; inset:0; pointer-events:none; opacity:.22;
    background-image:linear-gradient(rgba(255,255,255,.025) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.02) 1px,transparent 1px);
    background-size:32px 32px; mask-image:linear-gradient(to bottom,#000,transparent 75%); }
  .on-shell { width:min(1180px,calc(100% - 40px)); margin:0 auto; padding:42px 0 72px; position:relative; }
  .on-nav { display:flex; justify-content:space-between; align-items:center; gap:20px; margin-bottom:60px; }
  .on-brand { display:flex; align-items:center; gap:12px; font-weight:780; letter-spacing:.07em; text-transform:uppercase; }
  .on-mark { width:34px; height:34px; display:grid; place-items:center; border:1px solid #b7894d; border-radius:50%; color:#e4b76f; box-shadow:0 0 30px rgba(201,147,74,.18); }
  .on-nav-note { color:#a9b2aa; font-size:12px; letter-spacing:.09em; text-transform:uppercase; }
  .on-hero { display:grid; grid-template-columns:minmax(0,1.4fr) minmax(300px,.6fr); gap:42px; align-items:end; margin-bottom:42px; }
  .on-eyebrow { color:#d8a85e; font-size:12px; font-weight:800; letter-spacing:.2em; text-transform:uppercase; margin-bottom:14px; }
  .on-title { margin:0; max-width:820px; font:700 clamp(42px,7vw,82px)/.94 Georgia,serif; letter-spacing:-.045em; text-wrap:balance; }
  .on-intro { color:#b8c1b9; font-size:16px; max-width:510px; margin:18px 0 0; }
  .on-hero-note { border-left:1px solid #76613e; padding:4px 0 4px 22px; color:#c9c0ad; }
  .on-settings { background:linear-gradient(135deg,rgba(31,39,33,.93),rgba(23,23,19,.92)); border:1px solid #465047; border-radius:18px; padding:22px; box-shadow:0 20px 80px rgba(0,0,0,.24); margin-bottom:56px; }
  .on-settings-head,.on-section-head { display:flex; justify-content:space-between; gap:20px; align-items:end; }
  .on-settings h2,.on-section h2 { margin:0; font:650 24px/1.1 Georgia,serif; }
  .on-subtitle { color:#96a099; margin:6px 0 0; max-width:720px; }
  .on-reset { border:0; color:#d9c6a5; background:transparent; padding:7px 0; cursor:pointer; font:inherit; }
  .on-reset:hover { color:#fff1d6; }
  .on-settings-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:1px; background:#343b35; border:1px solid #343b35; border-radius:12px; overflow:hidden; margin-top:18px; }
  .on-setting { background:#151a16; padding:14px; min-width:0; }
  .on-setting label { display:block; color:#eee3ce; font-weight:700; margin-bottom:3px; }
  .on-setting small { display:block; color:#7f8b83; min-height:38px; font-size:11px; line-height:1.35; }
  .on-setting select,.on-setting input { width:100%; box-sizing:border-box; margin-top:9px; border:1px solid #465149; border-radius:7px; background:#0d110e; color:#eee8dc; padding:8px 9px; font:inherit; }
  .on-section { margin-top:52px; }
  .on-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:14px; margin-top:20px; }
  .on-card { position:relative; min-height:176px; padding:20px; text-align:left; color:#f2eadb; border:1px solid #3b473f; border-radius:14px; background:linear-gradient(145deg,rgba(28,35,30,.95),rgba(18,20,17,.97)); cursor:pointer; overflow:hidden; font:inherit; transition:transform .18s ease,border-color .18s ease,box-shadow .18s ease; }
  .on-card:hover { transform:translateY(-3px); border-color:#9a7645; box-shadow:0 18px 42px rgba(0,0,0,.32); }
  .on-card::after { content:"↗"; position:absolute; right:18px; bottom:16px; color:#c79550; font-size:18px; }
  .on-card-kicker { color:#89a796; font-size:10px; font-weight:800; letter-spacing:.16em; text-transform:uppercase; }
  .on-card-title { display:block; margin-top:18px; padding-right:24px; font:650 22px/1.08 Georgia,serif; }
  .on-card-summary { display:block; margin-top:9px; color:#9fa8a1; font-size:13px; line-height:1.45; max-width:90%; }
  .on-map-card { min-height:240px; padding-top:146px; }
  .on-map-thumb { position:absolute; inset:0 0 auto; width:100%; height:128px; object-fit:cover; background:#111; border-bottom:1px solid #3b473f; filter:saturate(.78) contrast(1.04); }
  .on-empty { margin-top:18px; border:1px dashed #465047; border-radius:14px; padding:24px; color:#9da79f; }
  .on-empty strong { display:block; color:#e4d8c2; margin-bottom:4px; }
  @media (max-width:900px) { .on-hero { grid-template-columns:1fr; } .on-settings-grid,.on-grid { grid-template-columns:repeat(2,minmax(0,1fr)); } }
  @media (max-width:620px) { .on-shell { width:min(100% - 24px,1180px); padding-top:24px; } .on-nav { margin-bottom:40px; } .on-nav-note { display:none; } .on-settings-grid,.on-grid { grid-template-columns:1fr; } .on-settings-head,.on-section-head { align-items:flex-start; flex-direction:column; } }
`;

export function styleMenu(): void {
  const style = document.createElement('style');
  style.textContent = MENU_CSS;
  document.head.append(style);
}
