// Generators for EDGAR-format XML documents. Used by the demo seeder and tests so
// that demo data goes through exactly the same parsers as live SEC filings.

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export interface InfoRow { name: string; cusip: string; value: number; shares: number; putCall?: 'Put' | 'Call'; type?: 'SH' | 'PRN'; title?: string }

export function infoTableXml(rows: InfoRow[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<informationTable xmlns="http://www.sec.gov/edgar/document/thirteenf/informationtable" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
${rows.map((r) => `  <infoTable>
    <nameOfIssuer>${esc(r.name)}</nameOfIssuer>
    <titleOfClass>${esc(r.title ?? 'COM')}</titleOfClass>
    <cusip>${r.cusip}</cusip>
    <value>${Math.round(r.value)}</value>
    <shrsOrPrnAmt>
      <sshPrnamt>${Math.round(r.shares)}</sshPrnamt>
      <sshPrnamtType>${r.type ?? 'SH'}</sshPrnamtType>
    </shrsOrPrnAmt>${r.putCall ? `\n    <putCall>${r.putCall}</putCall>` : ''}
    <investmentDiscretion>SOLE</investmentDiscretion>
    <votingAuthority>
      <Sole>${Math.round(r.shares)}</Sole>
      <Shared>0</Shared>
      <None>0</None>
    </votingAuthority>
  </infoTable>`).join('\n')}
</informationTable>`;
}

export function coverXml(o: { managerName: string; period: string; amendmentType?: 'RESTATEMENT' | 'NEW HOLDINGS'; entries: number; total: number }): string {
  const [y, m, d] = o.period.split('-');
  return `<?xml version="1.0" encoding="UTF-8"?>
<edgarSubmission xmlns="http://www.sec.gov/edgar/thirteenffiler" xmlns:com="http://www.sec.gov/edgar/common">
  <headerData>
    <submissionType>${o.amendmentType ? '13F-HR/A' : '13F-HR'}</submissionType>
    <filerInfo><periodOfReport>${m}-${d}-${y}</periodOfReport></filerInfo>
  </headerData>
  <formData>
    <coverPage>
      <reportCalendarOrQuarter>${m}-${d}-${y}</reportCalendarOrQuarter>
      <isAmendment>${o.amendmentType ? 'true' : 'false'}</isAmendment>${o.amendmentType ? `
      <amendmentInfo><amendmentType>${o.amendmentType}</amendmentType></amendmentInfo>` : ''}
      <filingManager><name>${esc(o.managerName)}</name></filingManager>
      <reportType>13F HOLDINGS REPORT</reportType>
    </coverPage>
    <summaryPage>
      <otherIncludedManagersCount>0</otherIncludedManagersCount>
      <tableEntryTotal>${o.entries}</tableEntryTotal>
      <tableValueTotal>${Math.round(o.total)}</tableValueTotal>
    </summaryPage>
  </formData>
</edgarSubmission>`;
}

export interface Form4Txn { title?: string; date: string; code: string; ad: 'A' | 'D'; shares: number; price: number | null; after: number; derivative?: boolean; indirect?: boolean }

export function form4Xml(o: {
  issuerCik: string; issuerName: string; ticker: string; ownerCik: string; ownerName: string;
  role: { director?: boolean; officerTitle?: string; tenPct?: boolean }; period: string; txns: Form4Txn[]; amendment?: boolean; tenB51?: boolean;
}): string {
  const txn = (t: Form4Txn) => `
    <${t.derivative ? 'derivativeTransaction' : 'nonDerivativeTransaction'}>
      <securityTitle><value>${esc(t.title ?? (t.derivative ? 'Stock Option (Right to Buy)' : 'Common Stock'))}</value></securityTitle>
      <transactionDate><value>${t.date}</value></transactionDate>
      <transactionCoding><transactionFormType>4</transactionFormType><transactionCode>${t.code}</transactionCode><equitySwapInvolved>0</equitySwapInvolved></transactionCoding>
      <transactionAmounts>
        <transactionShares><value>${t.shares}</value></transactionShares>
        <transactionPricePerShare>${t.price != null ? `<value>${t.price}</value>` : '<footnoteId id="F1"/>'}</transactionPricePerShare>
        <transactionAcquiredDisposedCode><value>${t.ad}</value></transactionAcquiredDisposedCode>
      </transactionAmounts>
      <postTransactionAmounts><sharesOwnedFollowingTransaction><value>${t.after}</value></sharesOwnedFollowingTransaction></postTransactionAmounts>
      <ownershipNature><directOrIndirectOwnership><value>${t.indirect ? 'I' : 'D'}</value></directOrIndirectOwnership></ownershipNature>
    </${t.derivative ? 'derivativeTransaction' : 'nonDerivativeTransaction'}>`;
  const nd = o.txns.filter((t) => !t.derivative);
  const dv = o.txns.filter((t) => t.derivative);
  return `<?xml version="1.0"?>
<ownershipDocument>
  <schemaVersion>X0508</schemaVersion>
  <documentType>${o.amendment ? '4/A' : '4'}</documentType>
  <periodOfReport>${o.period}</periodOfReport>
  <aff10b5One>${o.tenB51 ? '1' : '0'}</aff10b5One>
  <issuer><issuerCik>${o.issuerCik}</issuerCik><issuerName>${esc(o.issuerName)}</issuerName><issuerTradingSymbol>${o.ticker}</issuerTradingSymbol></issuer>
  <reportingOwner>
    <reportingOwnerId><rptOwnerCik>${o.ownerCik}</rptOwnerCik><rptOwnerName>${esc(o.ownerName)}</rptOwnerName></reportingOwnerId>
    <reportingOwnerRelationship>
      <isDirector>${o.role.director ? 1 : 0}</isDirector><isOfficer>${o.role.officerTitle ? 1 : 0}</isOfficer>
      <isTenPercentOwner>${o.role.tenPct ? 1 : 0}</isTenPercentOwner><isOther>0</isOther>${o.role.officerTitle ? `<officerTitle>${esc(o.role.officerTitle)}</officerTitle>` : ''}
    </reportingOwnerRelationship>
  </reportingOwner>
  ${nd.length ? `<nonDerivativeTable>${nd.map(txn).join('')}\n  </nonDerivativeTable>` : ''}
  ${dv.length ? `<derivativeTable>${dv.map(txn).join('')}\n  </derivativeTable>` : ''}
  <footnotes><footnote id="F1">Price not applicable.</footnote></footnotes>
</ownershipDocument>`;
}

export function schedule13Xml(o: { issuerCik: string; percent: number; shares: number; eventDate: string; purpose?: string }): string {
  return `<?xml version="1.0"?>
<edgarSubmission xmlns="http://www.sec.gov/edgar/schedule13D">
  <formData>
    <coverPageHeader><issuerInfo><issuerCik>${o.issuerCik}</issuerCik></issuerInfo><dateOfEvent>${o.eventDate}</dateOfEvent></coverPageHeader>
    <reportingPersons><reportingPersonInfo>
      <aggregateAmountOwned>${o.shares}</aggregateAmountOwned>
      <percentOfClass>${o.percent}</percentOfClass>
    </reportingPersonInfo></reportingPersons>
    ${o.purpose ? `<items1To7><item4><purposeOfTransaction>${esc(o.purpose)}</purposeOfTransaction></item4></items1To7>` : ''}
  </formData>
</edgarSubmission>`;
}
