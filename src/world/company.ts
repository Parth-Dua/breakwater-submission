// WORLD §1: Meridian Commodities, counterparties, ports, fleet. All fictional.
import type { CounterpartyDef, PortDef, Polygon, VesselDef } from "./types";

const rect = (west: number, south: number, east: number, north: number): Polygon => ({
  type: "Polygon",
  coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]],
});

export const COMPANY = { name: "Meridian Commodities SA", city: "Geneva", currency: "USD" } as const;

export const COUNTERPARTIES: CounterpartyDef[] = [
  { code: "NORDHAVN", name: "Nordhavn Shipping AS", kind: "OWNER", country: "NO", strategic: false },
  { code: "THALASSA", name: "Thalassa Bulk Carriers SA", kind: "OWNER", country: "GR", strategic: false },
  { code: "OKEANOS", name: "Okeanos Maritime Ltd", kind: "OWNER", country: "CY", strategic: false },
  { code: "PACCREST", name: "Pacific Crest Lines Pte", kind: "OWNER", country: "SG", strategic: false },
  { code: "KAIYO", name: "Kaiyo Kisen KK", kind: "OWNER", country: "JP", strategic: false },
  { code: "HANSA", name: "Hansa Mills GmbH", kind: "BUYER", country: "DE", strategic: true },
  { code: "LITORAL", name: "Litoral Grãos SA", kind: "SELLER", country: "BR", strategic: false },
  { code: "ALNOOR", name: "Al-Noor Flour Co", kind: "BUYER", country: "EG", strategic: false },
  { code: "PAMPAS", name: "Pampas Cereales SA", kind: "SELLER", country: "AR", strategic: false },
  { code: "SAIGONAG", name: "Saigon Agri Trading JSC", kind: "BUYER", country: "VN", strategic: true },
  { code: "MAASAGENCY", name: "Maas Port Agency BV", kind: "PORT_AGENT", country: "NL", strategic: false, sofTimezoneHabit: "Europe/Amsterdam" },
  { code: "LITAGENCY", name: "Agência Marítima Litoral", kind: "PORT_AGENT", country: "BR", strategic: false, sofTimezoneHabit: "America/Sao_Paulo" },
];

// WORLD §1.3. Rotterdam and Santos polygons are normative; the others are generated (synthetic, approximate).
export const PORTS: PortDef[] = [
  { code: "NLRTM", name: "Rotterdam", ianaZone: "Europe/Amsterdam", anchorage: rect(3.60, 51.95, 3.98, 52.08), anchorageName: "Maas anchorage", berth: rect(4.08, 51.945, 4.14, 51.965), berthName: "Europoort Grain Terminal", customsPortalName: "Rotterdam Customs Portal" },
  { code: "BRSSZ", name: "Santos", ianaZone: "America/Sao_Paulo", anchorage: rect(-46.40, -24.12, -46.22, -24.00), anchorageName: "Santos outer anchorage", berth: rect(-46.32, -23.98, -46.29, -23.96), berthName: "Santos Grain Terminal", customsPortalName: "Santos Customs Portal" },
  { code: "EGALY", name: "Alexandria", ianaZone: "Africa/Cairo", anchorage: rect(29.70, 31.20, 29.86, 31.30), anchorageName: "Alexandria outer anchorage", berth: rect(29.87, 31.17, 29.90, 31.19), berthName: "Alexandria Grain Berth", customsPortalName: "Alexandria Customs Portal" },
  { code: "ARROS", name: "Rosario", ianaZone: "America/Argentina/Buenos_Aires", anchorage: rect(-60.66, -32.98, -60.60, -32.92), anchorageName: "Rosario roads", berth: rect(-60.63, -32.91, -60.61, -32.89), berthName: "Rosario Terminal 6", customsPortalName: "Rosario Customs Portal" },
  { code: "VNCMP", name: "Cai Mep", ianaZone: "Asia/Ho_Chi_Minh", anchorage: rect(106.95, 10.35, 107.10, 10.45), anchorageName: "Vung Tau anchorage", berth: rect(107.02, 10.52, 107.05, 10.55), berthName: "Cai Mep Bulk Berth", customsPortalName: "Cai Mep Customs Portal" },
  { code: "USHOU", name: "Houston", ianaZone: "America/Chicago", anchorage: rect(-94.75, 29.25, -94.60, 29.35), anchorageName: "Galveston anchorage", berth: rect(-95.02, 29.72, -94.99, 29.74), berthName: "Houston Grain Elevator", customsPortalName: "Houston Customs Portal" },
];

export const FLEET: VesselDef[] = [
  { code: "ASTER_VALE", name: "MV Aster Vale", imo: "9700001", ownerCode: "NORDHAVN" },
  { code: "KESTREL", name: "MV Kestrel", imo: "9700002", ownerCode: "THALASSA" },
  { code: "HALDEN_STAR", name: "MV Halden Star", imo: "9700003", ownerCode: "OKEANOS" },
  { code: "SOLSTICE_BAY", name: "MV Solstice Bay", imo: "9700004", ownerCode: "PACCREST" },
  { code: "COBALT_REACH", name: "MV Cobalt Reach", imo: "9700005", ownerCode: "KAIYO" },
  { code: "ARDEN_TIDE", name: "MV Arden Tide", imo: "9700006", ownerCode: "NORDHAVN" },
  { code: "CORRAN_ISLE", name: "MV Corran Isle", imo: "9700007", ownerCode: "THALASSA" },
  { code: "JUNIPER_SOUND", name: "MV Juniper Sound", imo: "9700008", ownerCode: "OKEANOS" },
];

export const portByCode = (code: string) => {
  const port = PORTS.find(candidate => candidate.code === code);
  if (!port) throw new Error(`Unknown port ${code}`);
  return port;
};
export const vesselByCode = (code: string) => {
  const vessel = FLEET.find(candidate => candidate.code === code);
  if (!vessel) throw new Error(`Unknown vessel ${code}`);
  return vessel;
};
export const counterpartyByCode = (code: string) => {
  const counterparty = COUNTERPARTIES.find(candidate => candidate.code === code);
  if (!counterparty) throw new Error(`Unknown counterparty ${code}`);
  return counterparty;
};
