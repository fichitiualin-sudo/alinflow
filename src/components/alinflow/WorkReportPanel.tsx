"use client";

import { useEffect, useRef } from "react";
import type { Customer, QuoteItem, SellerCompany, WorkReport } from "@/lib/alinflow/types";
import { climateSummary } from "@/lib/alinflow/products";
import { fullCustomerAddress } from "@/lib/alinflow/format";
import { formatSignedAt, hasValidWorkReportSignature, workReportTitle } from "@/lib/alinflow/work-report";
import { appointmentSummaryLabel, appointmentWorkLabel, normalizeAppointmentType } from "@/lib/alinflow/appointments";

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
  onBack: () => void;
  onSave: (sendEmail: boolean) => void;
  onUpdateWorkReportField: (field: keyof WorkReport, value: string) => void;
  onSignatureChange: (value: string) => void;
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
  message,
  sellerCompanies,
  selectedSellerId,
  newSellerName,
  newSellerTaxNumber,
  newSellerRepresentative,
  purchaseDeclarationItemKeys,
  onBack,
  onSave,
  onUpdateWorkReportField,
  onSignatureChange,
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
  const climateLabel = isMaintenance ? "Karbantartandó klíma" : "Klíma";
  const hasValidSignature = hasValidWorkReportSignature(workReport);

  return (
    <Shell>
      <Back onClick={onBack}/>
      {message ? <div className="rounded-2xl border border-emerald-300/30 bg-emerald-400/20 p-4 font-black text-emerald-100">{message}</div> : null}
      <Layout>
        <Main>
          <Card title={`${reportTitle} adatai`}>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field label="Ügyfél" value={selected.name || "nincs megadva"}/>
              <Field label="Telepítési cím" value={fullCustomerAddress(selected)}/>
              <Field label="Időpont" value={selected.date ? appointmentSummaryLabel(selected) : `${scheduleDate} · ${shownTime}`}/>
              <Field label={climateLabel} value={climateSummary(quoteItems)}/>
            </div>
            <label className="mt-5 block rounded-2xl bg-slate-900/80 p-4">
              <span className="text-sm text-slate-400">Elvégzett {appointmentWorkLabel(selected.appointmentType).toLowerCase()} leírása</span>
              <textarea
                className="mt-2 min-h-32 w-full bg-transparent text-base font-bold leading-relaxed outline-none"
                value={workReport.workDescription}
                onChange={(event)=>onUpdateWorkReportField("workDescription", event.target.value)}
              />
            </label>
            <label className="mt-4 block rounded-2xl bg-slate-900/80 p-4">
              <span className="text-sm text-slate-400">Munkalap megjegyzés</span>
              <textarea
                className="mt-2 min-h-28 w-full bg-transparent text-base font-bold leading-relaxed outline-none"
                value={workReport.notes}
                onChange={(event)=>onUpdateWorkReportField("notes", event.target.value)}
                placeholder="Például: ügyfél tájékoztatva, rendben átadva, egyedi megjegyzés..."
              />
            </label>
          </Card>
          <Card title="Egyszerű ügyfél aláírás">
            <EditField
              label="Aláíró neve"
              value={workReport.signerName || selected.name || ""}
              onChange={(value)=>onUpdateWorkReportField("signerName", value)}
            />
            <SignaturePad value={workReport.signatureDataUrl} onChange={onSignatureChange}/>
            {hasValidSignature ? (
              <p className="mt-3 text-sm font-bold text-emerald-200">Aláírva: {formatSignedAt(workReport.signedAt)}</p>
            ) : (
              <p className="mt-3 text-sm font-bold text-amber-200">Még nincs aláírás.</p>
            )}
          </Card>
          {!isMaintenance ? (
            <Card title="Vásárlási nyilatkozat eladója">
              <label className="block rounded-2xl bg-slate-900/80 p-4">
                <span className="text-sm text-slate-400">Eladó / értékesítő cég</span>
                <select className="mt-2 w-full bg-transparent text-lg font-black outline-none" value={selectedSellerId} onChange={(event) => onSelectSeller(event.target.value)}>
                  {sellerCompanies.map((seller) => (
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
                  {quoteItems.map((item, index) => {
                    const key = String(index);
                    return (
                      <label key={key} className="flex items-center gap-3 rounded-xl bg-white/5 p-3 text-sm font-bold">
                        <input type="checkbox" checked={purchaseDeclarationItemKeys.includes(key)} onChange={() => onTogglePurchaseDeclarationItem(key)} />
                        <span>{climateSummary([item])}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            </Card>
          ) : null}
        </Main>
        <Side>
          <Gradient title="Munkalap státusz" value={hasValidSignature ? "Aláírva" : "Aláírásra vár"}/>
          <Card title="Műveletek">
            <div className="grid grid-cols-1 gap-3">
              <StepButton color="green" onClick={()=>onSave(false)}>{workReportBusy && !workReportEmailBusy ? "Mentés..." : "Munkalap mentése"}</StepButton>
              <StepButton color="blue" onClick={()=>onSave(true)}>{workReportEmailBusy ? "Email küldése..." : isMaintenance ? "Karbantartási munkalap email" : "Mentés és email küldése"}</StepButton>
            </div>
          </Card>
          <Card title="Email állapot">
            <InfoRow label="Ügyfél email" value={selected.email || "nincs megadva"}/>
            <InfoRow label="Elküldve" value={workReport.emailSentAt ? formatSignedAt(workReport.emailSentAt) : "még nem"}/>
          </Card>
        </Side>
      </Layout>
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
function Back({onClick}:{onClick:()=>void}){return <div className="sticky top-3 z-50 w-fit print:hidden"><button onClick={onClick} className="rounded-2xl border border-cyan-200/20 bg-slate-900/95 px-5 py-3 font-black text-cyan-100 shadow-2xl shadow-slate-950/40 backdrop-blur">← Vissza</button></div>}
function Field({label,value}:{label:string;value:string}){return <div className="rounded-2xl bg-slate-900/80 p-4"><p className="text-sm text-slate-400">{label}</p><p className="mt-1 text-lg font-black">{value}</p></div>}
function EditField({label,value,onChange}:{label:string;value:string;onChange:(value:string)=>void}) {return <label className="rounded-2xl bg-slate-900/80 p-4"><span className="text-sm text-slate-400">{label}</span><input className="mt-2 w-full bg-transparent text-lg font-black outline-none" value={value || ""} onChange={(event) => onChange(event.target.value)} /></label>}
function InfoRow({label,value}:{label:string;value:string}){return <div className="flex justify-between gap-4 border-b border-white/10 py-3 text-sm"><span className="text-slate-400">{label}</span><b className="text-right">{value}</b></div>}
function Gradient({title,value}:{title:string;value:string}) {return <section className="rounded-[2rem] bg-gradient-to-br from-cyan-300 to-blue-400 p-6 text-slate-950 shadow-2xl"><p className="text-sm font-black opacity-80">{title}</p><h3 className="mt-2 text-3xl font-black">{value}</h3></section>}
function StepButton({children,onClick,color="cyan"}:{children:React.ReactNode;onClick?:()=>void;color?:"green"|"blue"|"amber"|"cyan"|"red"|"slate"}) {
  const map: Record<string,string> = {green:"bg-emerald-400 text-slate-950",blue:"bg-blue-400 text-slate-950",amber:"bg-amber-300 text-slate-950",cyan:"bg-cyan-300 text-slate-950",red:"bg-red-500/90 text-white",slate:"bg-white/10 text-white"};
  return <button onClick={onClick} className={`rounded-2xl px-5 py-4 text-center font-black ${map[color] || map.cyan}`}>{children}</button>;
}

function SignaturePad({ value, onChange }: { value?: string; onChange: (value: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);

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
  }, [value]);

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

  return (
    <div className="mt-4 rounded-[1.5rem] border border-white/10 bg-white p-3">
      <canvas
        ref={canvasRef}
        className="h-56 w-full rounded-2xl bg-white"
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
      <button onClick={clearSignature} className="document-action-button mt-3 w-full rounded-2xl bg-slate-900 px-5 py-4 font-black text-white">Aláírás törlése</button>
    </div>
  );
}
