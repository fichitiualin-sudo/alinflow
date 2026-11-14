import { countSmsSegments, normalizeSmsPhone, type SmsSegmentCount } from "./sms-reminders";
import { settingsBrandName, type WorkspaceSettings } from "./workspace-settings";

export type MaintenanceContactSmsTarget =
  | { type: "own"; customerId: string; installationId: string }
  | { type: "shared"; grantId: string; installationId: string };

export type MaintenanceContactSmsDraft = {
  customerName: string;
  phone: string | null;
  text: string;
  encoding: SmsSegmentCount;
};
export type MaintenanceContactSmsResponse = { draft: MaintenanceContactSmsDraft };

const singleLine = (value: string | null | undefined) => String(value || "").replace(/\s+/g, " ").trim();

/** A preview only: composing or copying never claims that an SMS was sent. */
export function buildMaintenanceContactSms(
  customer: { name: string; phone: string },
  settings: WorkspaceSettings,
  sourceWorkspaceName?: string,
): MaintenanceContactSmsDraft {
  const savedName = singleLine(customer.name);
  const customerName = /\p{L}/u.test(savedName) ? savedName : "Ügyfelünk";
  const source = singleLine(sourceWorkspaceName);
  const sender = singleLine(source ? settings.companyProfile.legalName || settingsBrandName(settings) : settingsBrandName(settings));
  const callbackPhone = normalizeSmsPhone(settings.companyProfile.phone);
  const introduction = source
    ? `${source} nevében kerestük telefonon klímakarbantartás egyeztetése miatt`
    : "Klímakarbantartás egyeztetése miatt kerestük telefonon";
  const callback = callbackPhone ? `Kérjük, hívjon vissza: ${callbackPhone}.` : "Kérjük, hívjon vissza ezen a számon.";
  const text = `Kedves ${customerName}! ${introduction}, de nem értük el. ${callback} Köszönjük! ${sender}`;
  return { customerName, phone: normalizeSmsPhone(customer.phone), text, encoding: countSmsSegments(text) };
}
