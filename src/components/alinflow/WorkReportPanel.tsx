"use client";

import { useEffect, useRef, useState } from "react";
import type { Customer, PurchaseDeclaration, QuoteItem, SellerCompany, WorkReport } from "@/lib/alinflow/types";
import { climateSummary } from "@/lib/alinflow/products";
import { fullCustomerAddress } from "@/lib/alinflow/format";
import { formatSignedAt, hasValidWorkReportSignature, workAcceptanceText, workReportTitle, workReportSnapshotCustomer } from "@/lib/alinflow/work-report";
import { appointmentSummaryLabel, appointmentWorkLabel, normalizeAppointmentType } from "@/lib/alinflow/appointments";
import { Back } from "@/components/alinflow/LayoutPrimitives";
import { WorkSectionToggleButton } from "@/components/alinflow/WorkSectionToggleButton";
import { buildPrivacyNoticeContent, buildPrivacyNoticeSnapshot, normalizePrivacyNoticeConfig, partnerConsentText, privacyNoticeConfigValidation, privacyNoticeControllers, privacyControllerLabel, MAINTENANCE_PRIVACY_NOTICE_VERSION, type PrivacyNoticeConfig, type PrivacyNoticeSnapshot } from "@/lib/alinflow/privacy-notice";
import { PrivacyNoticeDocument } from "@/components/alinflow/PrivacyNoticeDocument";

type WorkReportPanelProps = {
  selected: Customer;
  quoteItems: QuoteItem[];
  scheduleDate: string;
  shownTime: string;
  workReport: WorkReport;
  workReportBusy: boolean;
  workReportEmailBusy: boolean;
  message: string;
  sellerCompanies: SellerCompany[];
  selectedSellerId: string;
  newSellerName: string;
  newSellerTaxNumber: string;
  newSellerRepresentative: string;
  purchaseDeclarationItemKeys: string[];
  purchaseDeclarationItems?: QuoteItem[];
  savedDeclaration?: PurchaseDeclaration;
  onBack: () => void;
  onSave: (sendEmail: boolean) => void;
  onUpdateWorkReportField: (field: keyof WorkReport, value: string) => void;
  privacyConfig?: PrivacyNoticeConfig;
  onSignatureChange: (value: string, signedAt?: string, notice?: PrivacyNoticeSnapshot) => void;
  onRevokePrivacyConsent?: () => void;
  onSelectSeller: (value: string) => void;
  onNewSellerNameChange: (value: string) => void;
  onNewSellerTaxNumberChange: (value: string) => void;
  onNewSellerRepresentativeChange: (value: string) => void;
  onAddSeller: () => void;
  onTogglePurchaseDeclarationItem: (key: string) => void;
};

export function WorkReportPanel({
  selected,
  quoteItems,
  scheduleDate,
  shownTime,
  workReport,
  workReportBusy,
  workReportEmailBusy,
  sellerCompanies,
  selectedSellerId,
  newSellerName,
  newSellerTaxNumber,
  newSellerRepresentative,
  purchaseDeclarationItemKeys,
  purchaseDeclarationItems = quoteItems,
  savedDeclaration,
  onBack,
  onSave,
  onUpdateWorkReportField,
  onSignatureChange,
  privacyConfig,
  onRevokePrivacyConsent,
  onSelectSeller,
  onNewSellerNameChange,
  onNewSellerTaxNumberChange,
  onNewSellerRepresentativeChange,
  onAddSeller,
  onTogglePurchaseDeclarationItem,
}: WorkReportPanelProps) {
  const appointmentType = normalizeAppointmentType(selected.appointmentType);
  const isMaintenance = appointmentType === "maintenance";
  const reportTitle = workReportTitle(selected.appointmentType);
  const climateLabel = isMaintenance ? "Karbantartandó klímák" : "Klíma";
  const hasValidSignature = hasValidWorkReportSignature(workReport);
  const documentCustomer = hasValidSignature ? workReportSnapshotCustomer(selected, workReport) : selected;
  const savedSeller = hasValidSignature && savedDeclaration ? {
    id: savedDeclaration.sellerCompanyId || selectedSellerId, name: savedDeclaration.sellerName,
    taxNumber: savedDeclaration.sellerTaxNumber, representative: savedDeclaration.sellerRepresentative,
  } : undefined;
  const editorSellers = savedSeller ? [savedSeller, ...sellerCompanies.filter((seller) => seller.id !== savedSeller.id)] : sellerCompanies;
  const [showPurchaseDeclaration, setShowPurchaseDeclaration] = useState(false);
  const [consentGranted, setConsentGranted] = useState(false);
  const [signatureError, setSignatureError] = useState("");
  const [signatureDraft, setSignatureDraft] = useState("");
  const privacy = normalizePrivacyNoticeConfig(privacyConfig);
  const privacyRevision = JSON.stringify([privacy, appointmentType]);
  const declarationRevision = JSON.stringify([selectedSellerId, purchaseDeclarationItemKeys, purchaseDeclarationItems]);
  const privacyErrors = privacyNoticeConfigValidation(privacy, { appointmentType });
  const noticeReady = privacy.enabled && privacyErrors.length === 0;
  const partnerReady = noticeReady && privacyNoticeConfigValidation(privacy, { requirePartner: true, appointmentType }).length === 0;
  const noticeControllers = privacyNoticeControllers(privacy, appointmentType);
  const controllerLabel = (role: PrivacyNoticeSnapshot["controllers"][number]["role"]) => privacyControllerLabel(role, isMaintenance ? MAINTENANCE_PRIVACY_NOTICE_VERSION : undefined);

  useEffect(() => {
    setShowPurchaseDeclaration(false);
    setConsentGranted(false);
    setSignatureError("");
    setSignatureDraft("");
  }, [selected.id, selected.activeAppointmentId, selected.activeWorkReportId]);

  useEffect(() => {
    if (!workReport.signatureDataUrl) setConsentGranted(false);
  }, [workReport.signatureDataUrl]);

  useEffect(() => {
    setConsentGranted(false);
    setSignatureDraft("");
  }, [privacyRevision]);

  useEffect(() => {
    setConsentGranted(false);
    setSignatureDraft("");
  }, [declarationRevision]);

  function updateField(field: keyof WorkReport, value: string) {
    if (workReport[field] !== value) {
      setConsentGranted(false);
      setSignatureDraft("");
    }
    onUpdateWorkReportField(field, value);
  }

  function startNewSignature() {
    setConsentGranted(false);
    setSignatureError("");
    setSignatureDraft("");
    onSignatureChange("");
  }

  function updateDeclaration(action: () => void) {
    setConsentGranted(false);
    setSignatureDraft("");
    setSignatureError("");
    action();
  }

  function sign(value: string) {
    if (!value) { startNewSignature(); return; }
    const signedAt = new Date().toISOString();
    try {
      if (privacy.enabled && !noticeReady) throw new Error(`Az adatkezelési tájékoztatóhoz szükséges adatok hiányosak. ${privacyErrors.join(" ")}`);
      const notice = noticeReady ? buildPrivacyNoticeSnapshot({
        config: privacy,
        appointmentType,
        customer: { name: selected.name, address: fullCustomerAddress(selected), phone: selected.phone || "", email: selected.email || "" },
        signerName: workReport.signerName || selected.name,
        signatureDataUrl: value, signedAt, consentGranted: partnerReady && consentGranted,
      }) : undefined;
      onSignatureChange(value, signedAt, notice);
      setSignatureDraft("");
      setSignatureError("");
    } catch (error) {
      setSignatureError(error instanceof Error ? error.message : "Az aláírás nem rögzíthető.");
    }
  }

  return (
    <Shell>
      <Back onClick={onBack} disabled={workReportBusy || workReportEmailBusy} />
      <fieldset disabled={workReportBusy || workReportEmailBusy} aria-busy={workReportBusy || workReportEmailBusy} className="min-w-0 border-0 p-0 disabled:pointer-events-none">
      <Layout>
        <Main>
          <Card title={`${reportTitle} adatai`}>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field label="Ügyfél" value={documentCustomer.name || "nincs megadva"}/>
              <Field label={isMaintenance ? "Karbantartási cím" : "Telepítési cím"} value={fullCustomerAddress(documentCustomer)}/>
              <Field label="Időpont" value={hasValidSignature && workReport.workDate
                ? `${workReport.workDate.replaceAll("-", ".")} · ${workReport.workTime || ""}`
                : selected.date ? appointmentSummaryLabel(selected) : `${scheduleDate} · ${shownTime}`}/>
              <Field label={climateLabel} value={hasValidSignature && workReport.documentSnapshot ? workReport.documentSnapshot.climateSummary : climateSummary(quoteItems)}/>
            </div>
            <label className="mt-5 block rounded-2xl bg-slate-900/80 p-4">
              <span className="text-sm text-slate-400">Elvégzett {appointmentWorkLabel(selected.appointmentType).toLowerCase()} leírása</span>
              <textarea
                className="mt-2 min-h-32 w-full bg-transparent text-base font-bold leading-relaxed outline-none"
                value={workReport.workDescription}
                onChange={(event)=>updateField("workDescription", event.target.value)}
              />
            </label>
            <label className="mt-4 block rounded-2xl bg-slate-900/80 p-4">
              <span className="text-sm text-slate-400">Munkalap megjegyzés</span>
              <textarea
                className="mt-2 min-h-28 w-full bg-transparent text-base font-bold leading-relaxed outline-none"
                value={workReport.notes}
                onChange={(event)=>updateField("notes", event.target.value)}
                placeholder="Például: ügyfél tájékoztatva, rendben átadva, egyedi megjegyzés..."
              />
            </label>
          </Card>
          {workReport.privacyNotice ? (
            <Card title="Adatkezelési tájékoztató">
              <p className="text-sm leading-relaxed">Az aláíráskor rögzített tájékoztató a munkalaphoz tartozik.</p>
              <details className="mt-3 rounded-2xl border border-slate-400/30 p-3">
                <summary className="cursor-pointer font-bold">Aláírt tájékoztató</summary>
                <div className="mt-4 overflow-hidden rounded-xl bg-white text-slate-900"><PrivacyNoticeDocument notice={workReport.privacyNotice} revokedAt={workReport.privacyConsentRevokedAt}/></div>
              </details>
              <p className="mt-3 text-sm font-bold">{workReport.privacyConsentRevokedAt ? `Partneri hozzájárulás visszavonva: ${formatSignedAt(workReport.privacyConsentRevokedAt)}` : workReport.privacyNotice.consentGranted ? `Partneri hozzájárulás: ${workReport.privacyNotice.partner?.legalName}` : "Partneri adatátadáshoz nincs hozzájárulás."}</p>
              {workReport.id && workReport.privacyNotice.consentGranted && !workReport.privacyConsentRevokedAt && onRevokePrivacyConsent ? (
                <button type="button" onClick={onRevokePrivacyConsent} className="mt-3 rounded-xl border border-slate-400/40 px-4 py-3 text-sm font-bold">Hozzájárulás visszavonásának rögzítése</button>
              ) : null}
            </Card>
          ) : privacy.enabled ? (
            <Card title="Adatkezelési tájékoztató">
              {noticeReady ? <>
                <div className="space-y-1 text-sm leading-relaxed">{noticeControllers.map(({ role, party }) => <p key={role}><b>{party.legalName}</b> – {controllerLabel(role)}</p>)}</div>
                <details className="mt-3 rounded-2xl border border-slate-400/30 p-4">
                  <summary className="cursor-pointer font-bold">A teljes tájékoztató elolvasása</summary>
                  <div className="mt-4 space-y-4 text-sm leading-relaxed">
                    {noticeControllers.map(({ role, party }) => <p key={role}><b>{party.legalName}</b><br/>{party.address}<br/>{party.email}{party.phone ? ` · ${party.phone}` : ""}{party.taxNumber ? <><br/>Adószám: {party.taxNumber}</> : null}</p>)}
                    {buildPrivacyNoticeContent(privacy, appointmentType).map((section) => <div key={section.title}><h3 className="font-bold">{section.title}</h3><p className="mt-1 whitespace-pre-line">{section.text}</p></div>)}
                  </div>
                </details>
                {hasValidSignature ? <p className="mt-3 text-sm">Ehhez a korábbi aláíráshoz nem tartozik tájékoztató. Az új tájékoztató rögzítéséhez az ügyfélnek ismét alá kell írnia.</p> : <>
                  {partnerReady ? <label className="mt-4 flex items-start gap-3 rounded-2xl border border-slate-400/30 p-4">
                    <input type="checkbox" className="mt-1 h-5 w-5 shrink-0 accent-emerald-500" checked={consentGranted} onChange={(event) => { setConsentGranted(event.target.checked); setSignatureDraft(""); }}/>
                    <span className="text-sm leading-relaxed"><b>Karbantartó partner – önkéntes</b><br/>{partnerConsentText(privacy, appointmentType)}<br/><span className="mt-2 block">{privacy.partner.address} · {privacy.partner.email}{privacy.partner.phone ? ` · ${privacy.partner.phone}` : ""}</span></span>
                  </label> : <p className="mt-3 text-sm">Karbantartó partner még nincs megadva; partneri adatátadáshoz nem kérünk hozzájárulást.</p>}
                  <p className="mt-3 text-sm">Az aláírás a tájékoztató átvételét is rögzíti.{partnerReady ? " A partneri adatátadás csak a külön pipa kijelölésével engedélyezett." : ""}</p>
                </>}
              </> : <p className="text-sm text-amber-700">A tájékoztató adatai még hiányosak. A Beállításokban egészítsd ki őket a munkalap aláírása előtt.</p>}
            </Card>
          ) : null}
          <Card title="Egyszerű ügyfél aláírás">
            <p className="mb-4 text-sm leading-relaxed">{workAcceptanceText(selected.appointmentType)}</p>
            <EditField
              label="Aláíró neve"
              value={workReport.signerName || selected.name || ""}
              onChange={(value)=>updateField("signerName", value)}
            />
            {hasValidSignature ? <div className="mt-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={workReport.signatureDataUrl} alt="Az ügyfél rögzített aláírása" className="h-40 w-full rounded-2xl bg-white object-contain"/>
              <button type="button" onClick={startNewSignature} className="mt-3 rounded-xl border border-slate-400/40 px-4 py-3 text-sm font-bold">Aláírás megismétlése</button>
            </div> : <>
              <SignaturePad value={signatureDraft} onChange={setSignatureDraft}/>
              <button type="button" disabled={!signatureDraft} onClick={() => sign(signatureDraft)} className="mt-3 w-full rounded-2xl bg-emerald-400 px-5 py-4 font-black text-slate-950 disabled:opacity-40">Aláírás rögzítése</button>
            </>}
            {signatureError ? <p role="alert" className="mt-3 text-sm font-bold text-red-600">{signatureError}</p> : null}
            {hasValidSignature ? (
              <p className="mt-3 text-sm font-bold text-emerald-200">Aláírva: {formatSignedAt(workReport.signedAt)}</p>
            ) : (
              <p className="mt-3 text-sm font-bold text-amber-200">Még nincs aláírás.</p>
            )}
          </Card>
          {!isMaintenance ? (
            <>
              <WorkSectionToggleButton
                label="Vásárlási nyilatkozat"
                icon="documents"
                open={showPurchaseDeclaration}
                onClick={() => setShowPurchaseDeclaration((open) => !open)}
              />
              {showPurchaseDeclaration ? (
            <Card title="Vásárlási nyilatkozat eladója">
              <label className="block rounded-2xl bg-slate-900/80 p-4">
                <span className="text-sm text-slate-400">Eladó / értékesítő cég</span>
                <select className="mt-2 w-full bg-transparent text-lg font-black outline-none" value={selectedSellerId} onChange={(event) => updateDeclaration(() => onSelectSeller(event.target.value))}>
                  {editorSellers.map((seller) => (
                    <option key={seller.id} value={seller.id}>{seller.name} · {seller.taxNumber}</option>
                  ))}
                </select>
              </label>

              <div className="mt-4 rounded-2xl bg-slate-900/80 p-4">
                <p className="text-sm font-black text-slate-300">Új eladó cég hozzáadása</p>
                <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
                  <input className="input" value={newSellerName} onChange={(event) => onNewSellerNameChange(event.target.value)} placeholder="Cégnév" />
                  <input className="input" value={newSellerTaxNumber} onChange={(event) => onNewSellerTaxNumberChange(event.target.value)} placeholder="Adószám" />
                  <input className="input" value={newSellerRepresentative} onChange={(event) => onNewSellerRepresentativeChange(event.target.value)} placeholder="Képviselő neve" />
                </div>
                <button type="button" onClick={onAddSeller} className="mt-3 rounded-2xl bg-cyan-300 px-5 py-4 font-black text-slate-950">Eladó cég mentése</button>
              </div>

              <div className="mt-4 rounded-2xl bg-slate-900/80 p-4">
                <p className="text-sm font-black text-slate-300">A nyilatkozatban szereplő termékek</p>
                <div className="mt-3 space-y-2">
                  {purchaseDeclarationItems.map((item, index) => {
                    const key = String(index);
                    return (
                      <label key={key} className="flex items-center gap-3 rounded-xl bg-white/5 p-3 text-sm font-bold">
                        <input type="checkbox" checked={purchaseDeclarationItemKeys.includes(key)} onChange={() => updateDeclaration(() => onTogglePurchaseDeclarationItem(key))} />
                        <span>{climateSummary([item])}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            </Card>
              ) : null}
            </>
          ) : null}
        </Main>
        <Side>
          <Gradient title="Munkalap státusz" value={hasValidSignature ? "Aláírva" : "Aláírásra vár"}/>
          <Card title="Műveletek">
            <div className="grid grid-cols-1 gap-3">
              <StepButton color="green" disabled={workReportBusy || workReportEmailBusy || Boolean(signatureDraft)} onClick={()=>onSave(false)}>{workReportBusy && !workReportEmailBusy ? "Mentés..." : "Munkalap mentése"}</StepButton>
              <StepButton color="blue" disabled={workReportBusy || workReportEmailBusy || Boolean(signatureDraft)} onClick={()=>onSave(true)}>{workReportEmailBusy ? "PDF-ek küldése..." : workReportBusy ? "Mentés..." : isMaintenance ? "Munkalap küldése PDF-ben" : "Mentés és PDF-ek küldése"}</StepButton>
              {signatureDraft ? <p className="text-sm">Mentés előtt nyomd meg az Aláírás rögzítése gombot.</p> : null}
            </div>
          </Card>
          <Card title="Email állapot">
            <InfoRow label="Ügyfél email" value={selected.email || "nincs megadva"}/>
            <InfoRow label="Elküldve" value={workReport.emailSentAt ? formatSignedAt(workReport.emailSentAt) : "még nem"}/>
          </Card>
        </Side>
      </Layout>
      </fieldset>
    </Shell>
  );
}

function Shell({children}:{children:React.ReactNode}) {
  return <main className="min-h-screen bg-slate-950 px-4 py-6 text-slate-100 md:px-8"><div className="mx-auto max-w-7xl space-y-6">{children}</div></main>;
}

function Layout({children}:{children:React.ReactNode}){return <section className="grid grid-cols-1 gap-6 xl:grid-cols-3">{children}</section>}
function Main({children}:{children:React.ReactNode}){return <div className="space-y-6 xl:col-span-2">{children}</div>}
function Side({children}:{children:React.ReactNode}){return <aside className="space-y-6">{children}</aside>}
function Card({title,children}:{title:string;children:React.ReactNode}){return <section className="rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-2xl"><h2 className="mb-5 text-2xl font-black">{title}</h2>{children}</section>}
function Field({label,value}:{label:string;value:string}){return <div className="rounded-2xl bg-slate-900/80 p-4"><p className="text-sm text-slate-400">{label}</p><p className="mt-1 text-lg font-black">{value}</p></div>}
function EditField({label,value,onChange}:{label:string;value:string;onChange:(value:string)=>void}) {return <label className="rounded-2xl bg-slate-900/80 p-4"><span className="text-sm text-slate-400">{label}</span><input className="mt-2 w-full bg-transparent text-lg font-black outline-none" value={value || ""} onChange={(event) => onChange(event.target.value)} /></label>}
function InfoRow({label,value}:{label:string;value:string}){return <div className="flex justify-between gap-4 border-b border-white/10 py-3 text-sm"><span className="text-slate-400">{label}</span><b className="text-right">{value}</b></div>}
function Gradient({title,value}:{title:string;value:string}) {return <section className="rounded-[2rem] bg-gradient-to-br from-cyan-300 to-blue-400 p-6 text-slate-950 shadow-2xl"><p className="text-sm font-black opacity-80">{title}</p><h3 className="mt-2 text-3xl font-black">{value}</h3></section>}
function StepButton({children,onClick,color="cyan",disabled=false}:{children:React.ReactNode;onClick?:()=>void;color?:"green"|"blue"|"amber"|"cyan"|"red"|"slate";disabled?:boolean}) {
  const map: Record<string,string> = {green:"bg-emerald-400 text-slate-950",blue:"bg-blue-400 text-slate-950",amber:"bg-amber-300 text-slate-950",cyan:"bg-cyan-300 text-slate-950",red:"bg-red-500/90 text-white",slate:"bg-white/10 text-white"};
  return <button onClick={onClick} disabled={disabled} className={`rounded-2xl px-5 py-4 text-center font-black disabled:cursor-wait disabled:opacity-60 ${map[color] || map.cyan}`}>{children}</button>;
}

function SignaturePad({ value, onChange }: { value?: string; onChange: (value: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const [fullscreen, setFullscreen] = useState(false);

  function prepareCanvas(redrawValue = value) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const rect = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.floor(rect.width * ratio));
    const height = Math.max(1, Math.floor(rect.height * ratio));
    canvas.width = width;
    canvas.height = height;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.scale(ratio, ratio);
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, rect.width, rect.height);
    context.strokeStyle = "#020617";
    context.lineWidth = 3;
    context.lineCap = "round";
    context.lineJoin = "round";

    if (redrawValue) {
      const image = new Image();
      image.onload = () => {
        context.drawImage(image, 0, 0, rect.width, rect.height);
      };
      image.src = redrawValue;
    }
  }

  useEffect(() => {
    prepareCanvas(value);
    const onResize = () => prepareCanvas(value);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [value, fullscreen]);

  useEffect(() => {
    if (!fullscreen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [fullscreen]);

  function pointFromEvent(event: any) {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function drawLine(from: { x: number; y: number }, to: { x: number; y: number }) {
    const context = canvasRef.current?.getContext("2d");
    if (!context) return;
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.stroke();
  }

  function finishSignature() {
    drawingRef.current = false;
    lastPointRef.current = null;
    const canvas = canvasRef.current;
    if (canvas) onChange(canvas.toDataURL("image/png"));
  }

  function clearSignature() {
    prepareCanvas("");
    onChange("");
  }

  function renderCanvas(className: string) {
    return (
      <canvas
        ref={canvasRef}
        className={`${className} rounded-2xl bg-white`}
        style={{ touchAction: "none" }}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture?.(event.pointerId);
          drawingRef.current = true;
          const point = pointFromEvent(event);
          lastPointRef.current = point;
          if (point) drawLine(point, { x: point.x + 0.1, y: point.y + 0.1 });
        }}
        onPointerMove={(event) => {
          if (!drawingRef.current) return;
          const point = pointFromEvent(event);
          const last = lastPointRef.current;
          if (point && last) drawLine(last, point);
          lastPointRef.current = point;
        }}
        onPointerUp={finishSignature}
        onPointerCancel={finishSignature}
        onPointerLeave={() => { if (drawingRef.current) finishSignature(); }}
      />
    );
  }

  return (
    <>
      <div className="mt-4 rounded-[1.5rem] border-2 border-cyan-300/70 bg-cyan-300/10 p-3 shadow-lg shadow-cyan-950/30">
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="font-black text-cyan-100">Az ügyfél ezen a fehér területen írjon alá.</p>
          <button
            type="button"
            onClick={() => setFullscreen(true)}
            className="document-action-button rounded-2xl bg-cyan-300 px-4 py-3 font-black text-slate-950"
          >
            Teljes képernyős aláírás
          </button>
        </div>
        {!fullscreen ? renderCanvas("h-56 w-full") : null}
        <button type="button" onClick={clearSignature} className="document-action-button mt-3 w-full rounded-2xl bg-slate-900 px-5 py-4 font-black text-white">Aláírás törlése</button>
      </div>

      {fullscreen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Teljes képernyős ügyfél-aláírás"
          className="fixed inset-0 z-[100] flex flex-col overflow-y-auto bg-slate-950 p-3 text-slate-100 sm:p-6"
        >
          <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-black sm:text-2xl">Ügyfél aláírása</h2>
              <p className="text-sm text-slate-300">Írjon alá a nagy, fehér területen.</p>
            </div>
            <button
              type="button"
              onClick={() => setFullscreen(false)}
              className="rounded-2xl bg-cyan-300 px-5 py-3 font-black text-slate-950"
            >
              Vissza a munkalaphoz
            </button>
          </div>
          <div className="mx-auto mt-3 flex min-h-[70dvh] w-full max-w-6xl flex-1 flex-col rounded-[2rem] border-2 border-cyan-300 bg-white p-3 shadow-2xl shadow-cyan-950/60">
            {renderCanvas("min-h-64 flex-1 w-full")}
            <button type="button" onClick={clearSignature} className="mt-3 w-full rounded-2xl bg-slate-900 px-5 py-4 font-black text-white">Aláírás törlése</button>
          </div>
        </div>
      ) : null}
    </>
  );
}
