import { PDFDocument, StandardFonts } from "pdf-lib";
import { winAnsi } from "./templates";

export type DeskLetter = { title: string; caseCode: string; vessel: string; counterparty: string; cents: number; filedAt: number; authority: string; rows?: string[]; references?: string[] };
/** Filed amounts, rows and evidence come from persisted engine/gateway records, never a model draft. */
export async function renderDeskLetter(input: DeskLetter): Promise<Uint8Array> {
  const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page = pdf.addPage([595.28,841.89]), y = 780;
  pdf.setTitle(input.title); pdf.setAuthor("Meridian Commodities SA"); pdf.setCreationDate(new Date(input.filedAt)); pdf.setModificationDate(new Date(input.filedAt));
  const money = `USD ${Math.floor(input.cents/100).toLocaleString("en-US")}.${String(input.cents%100).padStart(2,"0")}`;
  const lines = ["Meridian Commodities SA", input.title, "", `To: ${input.counterparty}`, `Vessel: ${input.vessel}`, `Case: ${input.caseCode}`, `Issued: ${new Date(input.filedAt).toISOString()}`, "", `Amount: ${money}`, `Authority: ${input.authority}`, "", ...(input.rows ?? []), "", ...(input.references?.length ? ["Supporting records (by reference):", ...input.references] : ["Supporting records are held with this case."])];
  for(const [index,line] of lines.entries()) {
    const size=index===0?16:index===1?14:10.5, face=index<2?bold:font, words=winAnsi(line).split(/\s+/); let chunk="";
    const draw=(text:string)=>{if(y<65){page=pdf.addPage([595.28,841.89]);y=780;}page.drawText(text,{x:48,y,font:face,size});y-=index<2?30:17;};
    for(const word of words){const next=chunk?`${chunk} ${word}`:word;if(chunk&&face.widthOfTextAtSize(next,size)>499){draw(chunk);chunk=word;}else chunk=next;} draw(chunk);
  }
  return pdf.save({useObjectStreams:false});
}
