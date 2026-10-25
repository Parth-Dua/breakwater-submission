import { assertCents,sumCents } from "./money";
export const accounts=["VOYAGE_EXPENSE","ACCRUED_LIABILITY","ACCOUNTS_PAYABLE"] as const;
export type Account=typeof accounts[number];
export type JournalLine={accountCode:Account;side:"DEBIT"|"CREDIT";amountCents:number};
export function validateJournal(lines:JournalLine[]) {
  if(lines.length<2)throw new Error("Journal requires at least two lines");
  for(const line of lines){assertCents(line.amountCents);if(line.amountCents===0 || !accounts.includes(line.accountCode) || !["DEBIT","CREDIT"].includes(line.side))throw new Error("Invalid journal account, side or amount");}
  const debits=sumCents(lines.filter(line=>line.side==="DEBIT").map(line=>line.amountCents));
  const credits=sumCents(lines.filter(line=>line.side==="CREDIT").map(line=>line.amountCents));
  if(debits!==credits)throw new Error("Unbalanced journal");
  return {debits,credits};
}
export function acceptedInvoiceLines(accrualCents:number,invoiceCents:number):JournalLine[] {
  assertCents(accrualCents);assertCents(invoiceCents);
  const lines:JournalLine[]=[];
  if(accrualCents)lines.push({accountCode:"ACCRUED_LIABILITY",side:"DEBIT",amountCents:accrualCents},{accountCode:"VOYAGE_EXPENSE",side:"CREDIT",amountCents:accrualCents});
  lines.push({accountCode:"VOYAGE_EXPENSE",side:"DEBIT",amountCents:invoiceCents},{accountCode:"ACCOUNTS_PAYABLE",side:"CREDIT",amountCents:invoiceCents});
  validateJournal(lines);return lines;
}
export function checkPostingAuthority(input:{invoiceAccepted:boolean;evidenceVerified:boolean;periodOpen:boolean;invoiceCents:number;accrualCents:number;invoiceLimit:number;accrualLimit:number;controllerApproved:boolean}) {
  if(!input.invoiceAccepted)throw new Error("Accepted invoice required");
  if(!input.evidenceVerified)throw new Error("Verified evidence and charter required");
  if(!input.periodOpen)throw new Error("Posting to locked or incorrect period denied");
  assertCents(input.invoiceCents);assertCents(input.accrualCents);
  assertCents(input.invoiceLimit);assertCents(input.accrualLimit);
  if(input.invoiceCents===0)throw new Error("Positive accepted invoice required");
  if(!input.controllerApproved && (input.invoiceCents>input.invoiceLimit || input.accrualCents>input.accrualLimit))throw new Error("Posting requires Controller approval");
}
export function sameJournalPlan(a:JournalLine[],b:JournalLine[]){return a.length===b.length&&a.every((line,index)=>line.accountCode===b[index].accountCode&&line.side===b[index].side&&line.amountCents===b[index].amountCents);}
