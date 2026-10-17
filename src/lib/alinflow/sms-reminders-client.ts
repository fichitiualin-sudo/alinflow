import type { AppointmentType } from "./types";

export type SmsReminderEntry = {
  appointmentId: string;
  customerId: string;
  customerName: string;
  appointmentType: Exclude<AppointmentType, "other">;
  date: string;
  time: string;
  arrivalWindow: string;
  phone: string | null;
  text: string;
  contentKey: string;
  encoding: { encoding: "GSM-7" | "UCS-2"; units: number; segments: number };
  acknowledgedAt: string | null;
  changedSinceAcknowledgement: boolean;
};
export type SmsRemindersResponse = { entries: SmsReminderEntry[]; date: string };
