#!/usr/bin/env python3
"""Cascade guest guide: liquid glass layer + muted line-icon system + alignment/shade fixes.
Usage: python3 apply.py /path/to/index.html   (edits in place; idempotent; every replacement is count-asserted)"""
import re,sys
MARK='/* lg1:'
CSS=r"""
/* lg1: liquid glass layer + muted line-icon system + alignment and shade fixes (both themes).
   Night = :root default, day = :root[data-day]. Solid fallbacks first; translucency and blur only inside @supports.
   Blur is reserved for floating layers (dock, sheet, hero keys, chips over photos); content cards get translucent paper only. */
:root{--glass-bg:rgba(36,28,18,.97);--glass-bg2:rgba(22,17,11,.98);--glass-border:rgba(255,240,215,.16);--glass-hi:rgba(255,244,222,.16);--glass-sheen:rgba(255,244,222,.07);--glass-shadow:0 1px 2px rgba(0,0,0,.3),0 16px 34px -18px rgba(0,0,0,.7);--glass-blur:0px;--glass-sat:100%;
 --paper:color-mix(in srgb,var(--card) 76%,transparent);--paper-hi:rgba(255,244,222,.07);--pg-bg:rgba(24,14,6,.74);--pg-border:rgba(255,240,215,.32);--pg-hi:rgba(255,255,255,.24);
 --ico:var(--goldt);--wx-sun:#E6B655;--wx-rain:#8EC1EF;--wx-alert:#E79486;--amb1:rgba(201,150,58,.10);--amb2:rgba(150,112,70,.09);--amb3:rgba(201,150,58,.06)}
:root[data-day]{--glass-bg:rgba(252,249,243,.97);--glass-bg2:rgba(246,241,232,.98);--glass-border:rgba(28,16,6,.10);--glass-hi:rgba(255,255,255,.9);--glass-sheen:rgba(255,255,255,.55);--glass-shadow:0 1px 2px rgba(28,16,6,.05),0 14px 30px -16px rgba(28,16,6,.28);
 --paper:color-mix(in srgb,var(--card) 80%,transparent);--paper-hi:rgba(255,255,255,.7);--wx-sun:#9A6A12;--wx-rain:var(--d-rain);--wx-alert:var(--red);--amb1:rgba(201,150,58,.13);--amb2:rgba(94,123,115,.10);--amb3:rgba(164,127,69,.12)}
@supports ((-webkit-backdrop-filter:blur(1px)) or (backdrop-filter:blur(1px))){
 :root{--glass-bg:rgba(44,33,21,.60);--glass-bg2:rgba(22,17,11,.82);--glass-blur:18px;--glass-sat:150%;--pg-bg:rgba(24,14,6,.42)}
 :root[data-day]{--glass-bg:rgba(252,249,243,.74);--glass-bg2:rgba(246,241,232,.93);--glass-sat:125%}
}
@media (prefers-reduced-transparency:reduce){
 :root{--glass-bg:#241c12;--glass-bg2:#16110b;--glass-blur:0px;--glass-sat:100%;--paper:var(--card);--pg-bg:rgba(24,14,6,.88)}
 :root[data-day]{--glass-bg:#FCF9F3;--glass-bg2:#F6F1E8;--paper:var(--card)}
}

/* ambient ground: a still, warm light behind each chapter so translucent paper has something to hold */
:root[data-theme] .ch{background:radial-gradient(70% 42% at 6% 16%,var(--amb1),transparent 70%),radial-gradient(62% 40% at 97% 62%,var(--amb2),transparent 70%),radial-gradient(60% 34% at 40% 104%,var(--amb3),transparent 70%),var(--bg)}
:root[data-day] .band.soft{background:color-mix(in srgb,var(--bg2) 62%,transparent)}
:root[data-day] .band.glow,:root[data-day] .band.dark:not(:has(.scene)){background:transparent}

/* the glass recipe: translucent fill + top sheen, 1px inner light edge, soft float shadow, backdrop blur */
:root[data-theme] :is(.quick button,.dots,.bell,.glassgold,.toast){background:linear-gradient(180deg,var(--glass-sheen),transparent 52%),var(--glass-bg)!important;border:1px solid var(--glass-border)!important;box-shadow:inset 0 1px 0 var(--glass-hi),var(--glass-shadow);-webkit-backdrop-filter:blur(var(--glass-blur)) saturate(var(--glass-sat));backdrop-filter:blur(var(--glass-blur)) saturate(var(--glass-sat))}
:root[data-theme] .sheet{background:linear-gradient(180deg,var(--glass-sheen),transparent 140px),var(--glass-bg2);border-top:1px solid var(--glass-border);box-shadow:inset 0 1px 0 var(--glass-hi),0 -24px 60px -24px rgba(0,0,0,.4);-webkit-backdrop-filter:blur(calc(var(--glass-blur)*1.3)) saturate(var(--glass-sat));backdrop-filter:blur(calc(var(--glass-blur)*1.3)) saturate(var(--glass-sat))}
/* dock */
:root[data-theme] .idx{background:color-mix(in srgb,var(--ink) 6%,transparent)!important;border-color:var(--glass-border)!important;-webkit-backdrop-filter:none;backdrop-filter:none;box-shadow:none}
:root:not([data-day]) .idx svg,:root:not([data-day]) .bell svg{stroke:#f2d79c}
:root[data-day] .dock .bell{background:linear-gradient(180deg,rgba(255,244,222,.14),transparent 52%),rgba(28,16,6,.86)!important;border-color:rgba(28,16,6,.5)!important;box-shadow:inset 0 1px 0 rgba(255,244,222,.25),var(--glass-shadow);-webkit-backdrop-filter:blur(var(--glass-blur)) saturate(var(--glass-sat));backdrop-filter:blur(var(--glass-blur)) saturate(var(--glass-sat))}
:root[data-day] .dot::after{opacity:.42}
:root[data-day] .dot[aria-current=true]::after{background:var(--goldt)}
:root[data-theme] .toast{color:var(--ink)}
/* hero keys: one metal tone in both themes, no coloured glow */
:root[data-theme] .quick button{color:var(--ink)}
:root[data-theme] .quick button::after{display:none}
:root[data-theme] .quick button svg,:root[data-theme] .quick .gw svg,:root[data-theme] .quick .gc svg{stroke:var(--ico)}
:root[data-theme] .quick button.hot{border-color:var(--gold)!important;box-shadow:inset 0 1px 0 var(--glass-hi),0 0 0 1px var(--gold),var(--glass-shadow)}
:root[data-theme] .quick button:active{background:var(--glass-bg)!important}
/* share panel: quiet glass, no spinning sheen, no gold bloom */
:root[data-theme] .glassgold::before{display:none}
/* glass over photographs (same in both themes, the photo decides): dark smoked glass, cream text */
:root[data-theme] :is(.cover .btn.glass,.btn.glass,.poster .stay span,.ph .mk,.g4 .e,.scrollcue){background:linear-gradient(180deg,rgba(255,250,240,.16),rgba(255,250,240,.03) 60%),var(--pg-bg);border:1px solid var(--pg-border);box-shadow:inset 0 1px 0 var(--pg-hi),0 8px 22px -12px rgba(0,0,0,.6);color:#fff7e8;text-shadow:none;-webkit-backdrop-filter:blur(12px) saturate(140%);backdrop-filter:blur(12px) saturate(140%)}
:root[data-theme] .ph .mk{color:#fbe9c4!important;background:linear-gradient(180deg,rgba(255,250,240,.12),rgba(255,250,240,.02) 60%),rgba(24,14,6,.66)!important}
:root[data-theme] .poster .stay .wxpill{background:linear-gradient(180deg,rgba(142,193,239,.30),rgba(142,193,239,.12)),var(--pg-bg)}
:root[data-theme] .ord .art .st{background:rgba(24,14,6,.68);color:#fff7e8;box-shadow:inset 0 0 0 1px rgba(255,240,215,.22)}
:root[data-theme] .ord .art .st.on::before{background:#8fb5a6}
:root[data-theme] .ph .nx{background:rgba(24,14,6,.64);opacity:1;box-shadow:inset 0 0 0 1px rgba(255,240,215,.22)}
:root[data-theme] .ord .art .pl{background:rgba(24,14,6,.62);padding:3px 10px;border-radius:99px;right:12px;bottom:10px}
:root[data-theme] .g4:not(#grabtaxi){--glow:rgba(201,150,58,.38)!important}
:root[data-day] .g4{box-shadow:none}

/* translucent paper for content cards on the ground: no blur (legibility, scrolling cost) */
:root[data-theme] :is(.card,.venue,.ord,.fold,.tile:where(:not(.photo)),.chip3,.ck,.ckc,.rule,.tpl,.pdetail,.nearby a,.x){background:var(--paper);box-shadow:inset 0 1px 0 var(--paper-hi),var(--shadow,0 0 0 transparent)}
:root:not([data-day]) :is(.venue,.ord,.fold){box-shadow:inset 0 1px 0 var(--paper-hi),0 10px 28px -14px rgba(0,0,0,.5)}
:root:not([data-day]) .band.dark .card{background:rgba(255,248,235,.06)}
:root[data-theme] .rule{background:radial-gradient(120% 90% at 100% 0%,var(--amb1),transparent 62%),var(--paper)}
:root[data-theme] .tile.glow{background:radial-gradient(120% 90% at 100% 0%,var(--amb1),transparent 60%),var(--paper)}
:root[data-theme] .filters button:not([aria-pressed=true]),:root[data-theme] .stagechips button:not([aria-pressed=true]){background:var(--paper)}
:root[data-theme] .note{background:color-mix(in srgb,var(--ld8) 78%,transparent)}
:root[data-theme] .miss,:root[data-theme] .locked{background:color-mix(in srgb,var(--chip) 72%,transparent)}
:root[data-theme] .pmap{background:radial-gradient(60% 60% at 50% 50%,var(--paper),color-mix(in srgb,var(--bg2) 60%,transparent))}
/* weather card sits inside the glass sheet: translucent, never a second blur */
:root:not([data-day]) .wx{background:linear-gradient(140deg,rgba(84,60,32,.55),rgba(36,24,12,.4));border:1px solid var(--glass-border);box-shadow:inset 0 1px 0 var(--glass-hi)}
:root[data-day] .wx{background:radial-gradient(90% 70% at 100% 0%,color-mix(in srgb,var(--d-rain) 11%,transparent),transparent 62%),var(--paper);box-shadow:inset 0 1px 0 var(--paper-hi),var(--shadow)}
:root[data-day] .wxh,:root[data-day] .wxgrid div,:root[data-day] .wxadv{background:color-mix(in srgb,var(--chip) 70%,transparent)}
/* checklist tiles: glass keys; same recipe without blur (five on a flat ground) */
:root[data-theme] .ckc{background:linear-gradient(180deg,var(--glass-sheen),transparent 52%),var(--paper);border-color:var(--glass-border);box-shadow:inset 0 1px 0 var(--glass-hi),var(--glass-shadow)}
:root[data-theme] .ckc[aria-checked=true]{background:radial-gradient(120% 100% at 50% 0%,color-mix(in srgb,var(--gold) 20%,transparent),transparent 70%),var(--paper);border-color:var(--gold);box-shadow:inset 0 1px 0 var(--glass-hi),0 0 0 1px color-mix(in srgb,var(--gold) 55%,transparent),var(--glass-shadow)}
:root[data-theme] .done{background:radial-gradient(100% 120% at 50% 0%,color-mix(in srgb,var(--gold) 22%,transparent),transparent 70%),var(--paper);box-shadow:inset 0 1px 0 var(--glass-hi),var(--glass-shadow)}
@media (prefers-reduced-transparency:reduce){
 :root *{-webkit-backdrop-filter:none!important;backdrop-filter:none!important}
 :root .letter,:root .gcard{background:rgba(36,22,10,.92)}
}

/* icons: one stroke, one metal tone at reduced emphasis, one size per context */
.i{width:1.2em;height:1.2em;flex:none;display:inline-block;vertical-align:-.22em;fill:none;stroke:currentColor}
.i .wa{stroke:var(--wx-sun)}.i .wb{stroke:var(--wx-rain)}.i .wd{stroke:var(--wx-alert)}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.btn svg,.quick svg,.idx svg,.bell svg,.tile .ic{stroke-width:1.5}
.btn .i{width:18px;height:18px;opacity:.9}
.chip3 .e,.rule .e,.ckc .e,.fold>summary .th,.pe,.locked .i,.nearby a .i,.filters .i,.wxadv .i{color:var(--ico)}
.chip3 .e{display:flex;justify-content:center;opacity:.9}.chip3 .e .i{width:26px;height:26px}
:root[data-theme] .rule .e{width:42px;height:42px;background:color-mix(in srgb,var(--chip) 80%,transparent);box-shadow:inset 0 0 0 1px var(--glass-border);margin-bottom:12px}
.rule .e .i{width:21px;height:21px}
.rule .wm{right:-14px;bottom:-22px;font-size:0;line-height:0;opacity:.055;color:var(--ico)}.rule .wm .i{width:104px;height:104px;stroke-width:1}
:root[data-theme] .rule{--tint:transparent}
.ckc .e{line-height:0;opacity:.9}.ckc .e .i{width:28px;height:28px}
.ckc[aria-checked=true] .e{transform:scale(1.06);opacity:1}
.ctile .e{line-height:0;color:#f2d79c}.ctile .e .i{width:30px;height:30px}
.g4 .e{color:#fbe9c4}.g4 .e .i{width:20px;height:20px}
.fold>summary .th .i{width:26px;height:26px;opacity:.9}
.fold>summary .th[data-ic=lifebuoy]{color:var(--wx-alert)}
.pe .i{width:20px;height:20px;opacity:.9}
.filters button{display:inline-flex;align-items:center;gap:6px}.filters .i{width:16px;height:16px}
.filters button[aria-pressed=true] .i{color:currentColor}
.nearby a .i{width:16px;height:16px}
.wxi{line-height:0;color:#f2d79c}:root[data-day] .wxi{color:var(--ico)}.wxi .i{width:44px;height:44px}
.wxh span .i,.wxd .wxdi .i,.wxr>span .i{width:20px;height:20px;color:var(--ico)}:root:not([data-day]) :is(.wxh,.wxd,.wxr) .i{color:#ecd9b0}
.wxdr .i,.rp .i{width:.95em;height:.95em;color:currentColor!important;margin-right:2px;vertical-align:-.12em}
.wxadv .i{margin-right:8px;width:1.25em;height:1.25em}:root:not([data-day]) .wxadv .i{color:#f2d79c}
.wxpill .i{margin-right:5px}
.locked .i{width:.9em;height:.9em;margin-right:4px;vertical-align:-.08em}
.pmap .pin circle.dot{filter:saturate(.62)}
.pmap .pin .pg{fill:none;stroke:#fff;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;pointer-events:none}

/* alignment: icon above title, text starts on one line across a row, equal heights */
:root[data-theme] .tile.glow{justify-content:flex-start;min-height:0!important;padding:22px}
:root[data-theme] .tile.glow .ic{position:static;width:30px;height:30px;margin:0 0 14px;stroke:var(--ico);opacity:.9;flex:none}
.ckl2{grid-template-columns:repeat(2,minmax(0,1fr))}
.ckc{justify-content:flex-start;gap:10px;padding:24px 12px 16px;min-height:120px;line-height:1.35}
.ckc:last-child:nth-child(odd){flex-direction:row;justify-content:center;align-items:center;min-height:76px;padding:14px 46px}
@media(min-width:640px){.ckl2{grid-template-columns:repeat(5,minmax(0,1fr));max-width:760px;margin-inline:auto}.ckc:last-child:nth-child(odd){grid-column:auto;flex-direction:column;justify-content:flex-start;min-height:120px;padding:24px 12px 16px}}

/* shade fixes: text over photographs measured below 4.5:1 gets a content-sized scrim, never a brighter colour */
.tile.photo{padding:0}
.tile.photo .tx{padding:46px 18px 18px;background:linear-gradient(180deg,rgba(20,12,4,0),rgba(20,12,4,.74) 42px,rgba(20,12,4,.9))}
.tile.photo::before{background:linear-gradient(180deg,rgba(28,16,6,.04) 30%,rgba(20,12,4,.5) 100%)}
:root[data-theme] .cover::after{background:linear-gradient(180deg,rgba(28,16,6,.22) 0%,rgba(24,14,5,.58) 40%,rgba(20,12,4,.9) 100%)}
.poster::after{background:radial-gradient(90% 55% at 50% 32%,rgba(28,16,6,.12),rgba(14,8,3,.7)),linear-gradient(180deg,rgba(20,12,4,.55) 0%,rgba(20,12,4,.38) 38%,rgba(20,12,4,.85) 100%)}
.scene{filter:blur(18px) brightness(.3) saturate(1.2)}
.g4::before{background:linear-gradient(180deg,rgba(20,12,4,.14) 12%,rgba(20,12,4,.74) 56%,rgba(20,12,4,.92))}
.g4 .credit{color:#fff;background:rgba(24,14,6,.6);padding:1px 7px;border-radius:99px;top:16px}
:root[data-theme] .ckc .tick{border-color:color-mix(in srgb,var(--goldt) 60%,transparent)}
:root[data-theme] :is(.g4 .e,.scrollcue){-webkit-backdrop-filter:none!important;backdrop-filter:none!important;background:linear-gradient(180deg,rgba(255,250,240,.14),rgba(255,250,240,.02) 60%),rgba(24,14,6,.56)}
/* centred copy is centred as a box too (a 62ch measure used to sit left on wide screens) */
.c>p,p.c,.addr>p,.head>p,p[style*="text-align:center"],[style*="text-align:center"]>p{margin-inline:auto!important}
"""
ICONS=r"""/* ---------- icon system: monochrome line icons (24 grid, 1.5 stroke, round caps, currentColor). Paths adapted from Feather (MIT) and Lucide (ISC); scooter drawn for Cascade. Sub-paths classed wa/wb/wd carry the only colour accents (sun amber, rain blue, alert red). ---------- */
const ICON={
map:'<path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3z"/><path d="M9 3v15M15 6v15"/>',
pin:'<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="2.6"/>',
compass:'<circle cx="12" cy="12" r="9.5"/><path d="M16.2 7.8l-2.1 6.3-6.3 2.1 2.1-6.3z"/>',
utensils:'<path d="M3 2v7a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6a2 2 0 0 0 2 2h3zm0 0v7"/>',
coffee:'<path d="M17 8h1a4 4 0 0 1 0 8h-1"/><path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4z"/><path d="M6 2v3M10 2v3M14 2v3"/>',
cart:'<circle cx="9" cy="20.5" r="1.2"/><circle cx="19" cy="20.5" r="1.2"/><path d="M1.5 2h3.6l2.6 12.6a2 2 0 0 0 2 1.6h8.9a2 2 0 0 0 2-1.6L22 7H6.2"/>',
bag:'<path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/>',
basket:'<path d="M2 11h20"/><path d="M3.5 11l1.6 7.4a2 2 0 0 0 2 1.6h9.8a2 2 0 0 0 2-1.6l1.6-7.4"/><path d="M5 11l4-7M19 11l-4-7"/><path d="M9 15v2M12 15v2M15 15v2"/>',
scooter:'<circle cx="5.5" cy="17.5" r="2.5"/><circle cx="18.5" cy="17.5" r="2.5"/><path d="M14 5h2.6l1.9 10"/><path d="M8 17.5h8l1.7-5.2"/><path d="M3 15a4.5 4.5 0 0 1 4.5-4.5H11v7"/><path d="M5.5 7.5h4.5"/>',
car:'<path d="M19 17h2a1 1 0 0 0 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4a1 1 0 0 0 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/>',
banknote:'<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.2"/><path d="M6 12h.01M18 12h.01"/>',
pill:'<path d="M10.5 20.5l10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7z"/><path d="M8.5 8.5l7 7"/>',
fuel:'<path d="M3 22h12M4 9h10"/><path d="M14 22V4a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v18"/><path d="M14 13h2a2 2 0 0 1 2 2v2a2 2 0 0 0 4 0V9.8a2 2 0 0 0-.6-1.4L18 5"/>',
dumbbell:'<path d="M6.5 6.5l11 11"/><path d="M21 21l-1-1M3 3l1 1"/><path d="M18 22l4-4M2 6l4-4M3 10l7-7M14 21l7-7"/>',
waves:'<path d="M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5c2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/><path d="M2 12c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/><path d="M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/>',
flame:'<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.4-.5-2-1-3-1.1-2.1-.2-4.1 2-6 .5 2.5 2 4.9 4 6.5s3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.2.4-2.3 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
wifi:'<path d="M5 12.6a11 11 0 0 1 14 0"/><path d="M1.5 9a16 16 0 0 1 21 0"/><path d="M8.5 16.1a6 6 0 0 1 7 0"/><path d="M12 20h.01"/>',
torch:'<path d="M18 6c0 2-2 2-2 4v10a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2V10c0-2-2-2-2-4V2h12z"/><path d="M6 6h12M12 12v2"/>',
bulb:'<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6M10 22h4"/>',
key:'<circle cx="7.5" cy="15.5" r="5.5"/><path d="M11.4 11.6L21 2M15.5 7.5l3 3L22 7l-3-3"/>',
door:'<path d="M18 20V6a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v14"/><path d="M2 20h20M14 12v.01"/>',
trash:'<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M10 11v6M14 11v6"/>',
luggage:'<rect x="5" y="7" width="14" height="13" rx="2"/><path d="M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3"/><path d="M9.5 11v5M14.5 11v5M8 20v1.5M16 20v1.5"/>',
slippers:'<path d="M4 16v-2.4C4 11.5 3 10.5 3 8c0-2.7 1.5-6 4.5-6C9.4 2 10 3.8 10 5.5c0 3.1-2 5.7-2 8.7V16a2 2 0 1 1-4 0z"/><path d="M20 20v-2.4c0-2.1 1-3.1 1-5.6 0-2.7-1.5-6-4.5-6C14.6 6 14 7.8 14 9.5c0 3.1 2 5.7 2 8.7V20a2 2 0 1 0 4 0z"/><path d="M16 17h4M4 13h4"/>',
nosmoke:'<path d="M12 12H3a1 1 0 0 0-1 1v2a1 1 0 0 0 1 1h13"/><path d="M18 8c0-2.5-2-2.5-2-5M22 8c0-2.5-2-2.5-2-5"/><path d="M21 16a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1h-.5M7 12v4"/><path class="wd" d="M2 2l20 20"/>',
pot:'<path d="M2 12h20"/><path d="M20 12v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8"/><path d="M4 8l16-4"/><path d="M8.9 6.8l-.5-1.8a2 2 0 0 1 1.5-2.4l1.9-.5a2 2 0 0 1 2.4 1.5l.5 1.8"/>',
moon:'<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
feather:'<path d="M20.2 12.2a6 6 0 0 0-8.5-8.5L5 10.5V19h8.5z"/><path d="M16 8L2 22M17.5 15H9"/>',
drop:'<path d="M12 2.7l5.7 5.7a8 8 0 1 1-11.3 0z"/>',
lifebuoy:'<circle cx="12" cy="12" r="9.5"/><circle cx="12" cy="12" r="4"/><path d="M5.3 5.3l3.9 3.9M14.8 14.8l3.9 3.9M14.8 9.2l3.9-3.9M5.3 18.7l3.9-3.9"/>',
book:'<path d="M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2z"/><path d="M22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7z"/>',
lock:'<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
umbrella:'<path class="wb" d="M22 12a10 10 0 0 0-20 0z"/><path d="M12 12v7a2.5 2.5 0 0 0 5 0"/><path d="M12 2v1"/>',
bolt:'<path class="wa" d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
wind:'<path d="M9.6 4.6A2 2 0 1 1 11 8H2M12.6 19.4A2 2 0 1 0 14 16H2M17.7 7.7A2.5 2.5 0 1 1 19.5 12H2"/>',
sun:'<g class="wa"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4"/></g>',
cloudsun:'<g class="wa"><path d="M12 2v2M4.9 4.9l1.4 1.4M20 12h2M19.1 4.9l-1.4 1.4"/><path d="M15.9 12.6a4 4 0 0 0-5.9-4.1"/></g><path d="M13 22H7a5 5 0 1 1 4.9-6H13a3 3 0 0 1 0 6z"/>',
cloud:'<path d="M17.5 19H9a7 7 0 1 1 6.7-9h1.8a4.5 4.5 0 0 1 0 9z"/>',
fog:'<path d="M4 14.9A7 7 0 1 1 15.7 8h1.8a4.5 4.5 0 0 1 2.5 8.2"/><path d="M16 17H7M17 21H9"/>',
drizzle:'<path d="M4 14.9A7 7 0 1 1 15.7 8h1.8a4.5 4.5 0 0 1 2.5 8.2"/><path class="wb" d="M8 19v1M8 14v1M16 19v1M16 14v1M12 21v1M12 16v1"/>',
rain:'<path d="M4 14.9A7 7 0 1 1 15.7 8h1.8a4.5 4.5 0 0 1 2.5 8.2"/><path class="wb" d="M16 14v6M8 14v6M12 16v6"/>',
storm:'<path d="M6 16.3A7 7 0 1 1 15.7 8h1.8a4.5 4.5 0 0 1 .5 9"/><path class="wa" d="M13 12l-3 5h4l-3 5"/>',
dot:'<circle cx="12" cy="12" r="2"/>'};
const ic=(n,c)=>`<svg class="i${c?' '+c:''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICON[n]||ICON.dot}</svg>`;
$$('[data-ic]').forEach(e=>{e.innerHTML=ic(e.dataset.ic)});
"""
VS='️'
def emo_re(old):
    # exact-match regex for `old` that tolerates an optional variation selector after any non-ASCII symbol
    out=[]
    for ch in old.replace(VS,''):
        out.append(re.escape(ch))
        if ord(ch)>0x2000: out.append(VS+'?')
    return ''.join(out)
def main(path):
    s=open(path,encoding='utf-8').read()
    if MARK in s:
        print('already applied, nothing to do');return 0
    n_emoji=[0]
    def rep(old,new,count=1):
        nonlocal s
        s2,n=re.subn(emo_re(old),lambda m:new,s)
        assert n==count,f'expected {count} match(es), found {n}: {old[:70]!r}'
        s=s2
    E=lambda k:f'<span class="e" aria-hidden="true" data-ic="{k}"></span>'
    # ---- HTML: static emoji -> data-ic hooks (hydrated by the icon module) ----
    for emo,k in (('🗺','map'),('🍽','utensils'),('🛵','scooter'),('🚕','car')):
        rep(f'<span class="e" aria-hidden="true">{emo}</span>',E(k))
    rep('<span class="th">📖</span>','<span class="th" aria-hidden="true" data-ic="book"></span>')
    rep('<span class="th">🤝</span>','<span class="th" aria-hidden="true" data-ic="lifebuoy"></span>')
    for emo,k in (('💧','drop'),('📶','wifi'),('🔦','torch')):
        rep(f'<span class="e">{emo}</span>',E(k))
    S=lambda k:f'<span data-ic="{k}"></span>'
    rep('data-open="nearby">🗺 Nearby places, with directions','data-open="nearby">'+S('map')+'Nearby places, with directions')
    for emo,k,t in (('✨','compass','Attractions'),('☕','coffee','Cafés'),('🍽','utensils','Restaurants'),('🏧','banknote','ATMs'),('💊','pill','Pharmacies'),('🛒','cart','Groceries')):
        rep(f'">{emo} {t}</a>','">'+S(k)+t+'</a>')
    rep('">🍽 Restaurants near Cascade</a>','">'+S('utensils')+'Restaurants near Cascade</a>')
    rep('">☕ Cafés nearby</a>','">'+S('coffee')+'Cafés nearby</a>')
    rep('<span class="wxi" id="wxi">⛅</span>','<span class="wxi" id="wxi" aria-hidden="true" data-ic="cloudsun"></span>')
    # ---- JS: icon module after the existing svg() helper ----
    anchor="const svg=k=>`<svg class=\"ic\" viewBox=\"0 0 24 24\" fill=\"none\" stroke-width=\"1.4\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\">${IC[k]}</svg>`;\n"
    assert s.count(anchor)==1,'icon module anchor not found'
    s=s.replace(anchor,anchor+ICONS)
    # ---- JS data: emoji -> icon names ----
    rep('<p class="serif" style="font-size:1.4rem;margin:0 0 6px">🔒 ${what}</p>','<p class="serif" style="font-size:1.4rem;margin:0 0 6px">${ic(\'lock\')}${what}</p>')
    for emo,k,nxt in (('🕊','feather','"rgba(150,170,200,.18)"'),('🩴','slippers','"rgba(201,150,58,.18)"'),('🚭','nosmoke','"rgba(110,160,110,.18)"'),('🍳','pot','"rgba(220,150,80,.18)"'),('🌙','moon','"rgba(120,110,170,.18)"'),('💧','drop','"rgba(90,150,190,.18)"'),('💡','bulb','"rgba(220,180,80,.2)"')):
        rep(f'["{emo}",{nxt}',f'["{k}",{nxt}')
    for emo,k,nxt in (('🛍','bag','"Sari-sari store"'),('🔥','flame','"Ate Kriss BBQ"'),('🧺','basket','"Square Space Mini Grocery"')):
        rep(f'["{emo}",{nxt}',f'["{k}",{nxt}')
    rep('const PCAT=[["all","All","🗺"],["food","Food","🍖"],["store","Stores","🛍"],["cafe","Cafés","☕"],["atm","ATMs","🏧"],["pharmacy","Pharmacy","💊"],["fuel","Fuel","⛽"],["fitness","Fitness","🏋"],["resort","Pools","🏊"],["mall","Shopping","🛒"]];',
        'const PCAT=[["all","All","map"],["food","Food","utensils"],["store","Stores","bag"],["cafe","Cafés","coffee"],["atm","ATMs","banknote"],["pharmacy","Pharmacy","pill"],["fuel","Fuel","fuel"],["fitness","Fitness","dumbbell"],["resort","Pools","waves"],["mall","Shopping","cart"]];')
    rep('const CHECK=[["🗑","Trash in the bins"],["🧳","Belongings packed"],["💡","Lights and aircon off"],["🔑","Key card on the tray"],["🚪","Door closed firmly"]];',
        'const CHECK=[["trash","Trash in the bins"],["luggage","Belongings packed"],["bulb","Lights and aircon off"],["key","Key card on the tray"],["door","Door closed firmly"]];')
    # ---- JS render sites ----
    rep('<span class="e" aria-hidden="true">${a[0]}</span><span class="wm" aria-hidden="true">${a[0]}</span>','<span class="e" aria-hidden="true">${ic(a[0])}</span><span class="wm" aria-hidden="true">${ic(a[0])}</span>')
    rep('<span class="e" aria-hidden="true">${a[0]}</span><h4>${esc(a[1])}</h4>','<span class="e" aria-hidden="true">${ic(a[0])}</span><h4>${esc(a[1])}</h4>')
    rep('<span class="e" aria-hidden="true">${c[0]}</span>','<span class="e" aria-hidden="true">${ic(c[0])}</span>')
    rep('<div class="bg" style="background-image:url(img/${a.img}.webp)"></div><h4>${esc(a.h)}</h4><p>${esc(a.p)}</p></div>`','<div class="bg" style="background-image:url(img/${a.img}.webp)"></div><div class="tx"><h4>${esc(a.h)}</h4><p>${esc(a.p)}</p></div></div>`')
    rep('<text text-anchor="middle" y="4" aria-hidden="true">${em[p[1]]||\'\'}</text>','<g class="pg" transform="translate(-5.5,-5.5) scale(.4583)" aria-hidden="true">${ICON[em[p[1]]]||\'\'}</g>')
    rep('aria-pressed="${c[0]===pcat}">${c[2]} ${esc(c[1])}</button>','aria-pressed="${c[0]===pcat}">${ic(c[2])}${esc(c[1])}</button>')
    rep('<span class="pe" aria-hidden="true">${em[p[1]]||\'📍\'}</span>','<span class="pe" aria-hidden="true">${ic(em[p[1]]||\'pin\')}</span>')
    # ---- weather: colour-accented line icons ----
    rep("const WXI={0:'☀',1:'🌤',2:'⛅',3:'☁',45:'🌫',48:'🌫',51:'🌦',53:'🌦',55:'🌦',61:'🌧',63:'🌧',65:'🌧',80:'🌦',81:'🌧',82:'🌧',95:'⛈',96:'⛈',99:'⛈'};",
        "const WXI={0:'sun',1:'cloudsun',2:'cloudsun',3:'cloud',45:'fog',48:'fog',51:'drizzle',53:'drizzle',55:'drizzle',61:'rain',63:'rain',65:'rain',80:'drizzle',81:'rain',82:'rain',95:'storm',96:'storm',99:'storm'};")
    rep("const wxIcon=c=>WXI[c]||'⛅';","const wxIcon=c=>ic(WXI[c]||'cloudsun');")
    rep("$('#wxi').textContent=wxIcon(c.code);","$('#wxi').innerHTML=wxIcon(c.code);")
    rep("if(thunder)adv='⛈ Thunderstorms are possible today. A cosy day to stay in.';","if(thunder)adv=ic('storm')+'Thunderstorms are possible today. A cosy day to stay in.';")
    rep("adv=`☔ Rain is likely around ${hourOf(soon.time)} (${hi}%). An umbrella waits by the door.`}","adv=`${ic('umbrella')}Rain is likely around ${esc(hourOf(soon.time))} (${esc(hi)}%). An umbrella waits by the door.`}")
    rep("adv=`🌦 ${t.description||'A passing shower is possible.'} (${t.rain_prob}% chance)`;","adv=`${ic('drizzle')}${esc(t.description||'A passing shower is possible.')} (${esc(t.rain_prob)}% chance)`;")
    rep("else adv=`🌤 A lovely day to be out. Sunscreen is your friend: UV is ${c.uv_label||'strong'}.`;","else adv=`${ic('cloudsun')}A lovely day to be out. Sunscreen is your friend: UV is ${esc(c.uv_label||'strong')}.`;")
    rep("$('#wxadv').textContent=adv;","$('#wxadv').innerHTML=adv;")
    rep("'<span class=\"wxpill\">☔ Rain soon</span>'","'<span class=\"wxpill\">'+ic('umbrella')+'Rain soon</span>'")
    rep('<span class="rp">💧${x.rain}%</span>','<span class="rp">${ic(\'drop\')}<span class="sr">Rain </span>${x.rain}%</span>')
    rep('<span class="wxdr">💧${x.rain_prob}%${x.thunder_prob>10?` · ⚡${x.thunder_prob}%`:\'\'}</span>','<span class="wxdr">${ic(\'drop\')}<span class="sr">Rain </span>${x.rain_prob}%${x.thunder_prob>10?` · ${ic(\'bolt\')}<span class="sr">Thunder </span>${x.thunder_prob}%`:\'\'}</span>')
    # ---- CSS: one block appended at the end of the main <style> ----
    tail='html.thx *{transition:background-color .6s ease,color .6s ease,border-color .6s ease!important}\n</style>'
    assert s.count(tail)==1,'style tail anchor not found'
    s=s.replace(tail,tail[:-len('</style>')]+CSS.lstrip('\n')+'</style>')
    # ---- post-conditions ----
    left=[c for c in s if (0x1F000<=ord(c)<=0x1FAFF) or (0x2600<=ord(c)<=0x27BF and c not in '✦★✓') or ord(c) in (0x2B50,0x26A1)]
    assert not left,f'emoji still present: {"".join(left)}'
    assert s.count(MARK)==1
    open(path,'w',encoding='utf-8').write(s)
    print('applied: lg1 glass layer, icon module (%d icons), emoji remaining: %d'%(ICONS.count("':'")+ICONS.count("\n")-5,len(left)));return 0
if __name__=='__main__':
    sys.exit(main(sys.argv[1]))
