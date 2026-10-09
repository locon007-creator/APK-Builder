// Hand-written fixtures in the shape of real EDGAR documents (namespace prefixes,
// <value> wrappers, footnote-only prices) — deliberately independent of the demo generator.

export const INFO_TABLE_PREFIXED = `<?xml version="1.0" encoding="UTF-8"?>
<ns1:informationTable xmlns:ns1="http://www.sec.gov/edgar/document/thirteenf/informationtable">
  <ns1:infoTable>
    <ns1:nameOfIssuer>APPLE INC</ns1:nameOfIssuer><ns1:titleOfClass>COM</ns1:titleOfClass><ns1:cusip>037833100</ns1:cusip>
    <ns1:value>1500000</ns1:value>
    <ns1:shrsOrPrnAmt><ns1:sshPrnamt>10000</ns1:sshPrnamt><ns1:sshPrnamtType>SH</ns1:sshPrnamtType></ns1:shrsOrPrnAmt>
    <ns1:investmentDiscretion>SOLE</ns1:investmentDiscretion>
    <ns1:votingAuthority><ns1:Sole>10000</ns1:Sole><ns1:Shared>0</ns1:Shared><ns1:None>0</ns1:None></ns1:votingAuthority>
  </ns1:infoTable>
  <ns1:infoTable>
    <ns1:nameOfIssuer>APPLE INC</ns1:nameOfIssuer><ns1:titleOfClass>COM</ns1:titleOfClass><ns1:cusip>037833100</ns1:cusip>
    <ns1:value>300000</ns1:value>
    <ns1:shrsOrPrnAmt><ns1:sshPrnamt>2000</ns1:sshPrnamt><ns1:sshPrnamtType>SH</ns1:sshPrnamtType></ns1:shrsOrPrnAmt>
    <ns1:investmentDiscretion>DFND</ns1:investmentDiscretion>
    <ns1:votingAuthority><ns1:Sole>0</ns1:Sole><ns1:Shared>2000</ns1:Shared><ns1:None>0</ns1:None></ns1:votingAuthority>
  </ns1:infoTable>
  <ns1:infoTable>
    <ns1:nameOfIssuer>APPLE INC</ns1:nameOfIssuer><ns1:titleOfClass>CALL</ns1:titleOfClass><ns1:cusip>037833100</ns1:cusip>
    <ns1:value>450000</ns1:value>
    <ns1:shrsOrPrnAmt><ns1:sshPrnamt>3000</ns1:sshPrnamt><ns1:sshPrnamtType>SH</ns1:sshPrnamtType></ns1:shrsOrPrnAmt>
    <ns1:putCall>Call</ns1:putCall>
    <ns1:investmentDiscretion>SOLE</ns1:investmentDiscretion>
    <ns1:votingAuthority><ns1:Sole>0</ns1:Sole><ns1:Shared>0</ns1:Shared><ns1:None>0</ns1:None></ns1:votingAuthority>
  </ns1:infoTable>
  <ns1:infoTable>
    <ns1:nameOfIssuer>ACME CORP NOTE 2.5% 2030</ns1:nameOfIssuer><ns1:titleOfClass>NOTE</ns1:titleOfClass><ns1:cusip>00000a10 9</ns1:cusip>
    <ns1:value>99000</ns1:value>
    <ns1:shrsOrPrnAmt><ns1:sshPrnamt>100000</ns1:sshPrnamt><ns1:sshPrnamtType>PRN</ns1:sshPrnamtType></ns1:shrsOrPrnAmt>
    <ns1:investmentDiscretion>SOLE</ns1:investmentDiscretion>
    <ns1:votingAuthority><ns1:Sole>0</ns1:Sole><ns1:Shared>0</ns1:Shared><ns1:None>0</ns1:None></ns1:votingAuthority>
  </ns1:infoTable>
  <ns1:infoTable>
    <ns1:nameOfIssuer>BROKEN ROW</ns1:nameOfIssuer><ns1:cusip>123456789</ns1:cusip>
  </ns1:infoTable>
</ns1:informationTable>`;

export const COVER_RESTATEMENT = `<?xml version="1.0" encoding="UTF-8"?>
<edgarSubmission xmlns="http://www.sec.gov/edgar/thirteenffiler">
  <headerData><submissionType>13F-HR/A</submissionType><filerInfo><periodOfReport>06-30-2025</periodOfReport></filerInfo></headerData>
  <formData>
    <coverPage>
      <reportCalendarOrQuarter>06-30-2025</reportCalendarOrQuarter>
      <isAmendment>true</isAmendment>
      <amendmentInfo><amendmentType>RESTATEMENT</amendmentType></amendmentInfo>
      <filingManager><name>Example Capital LLC</name></filingManager>
      <reportType>13F HOLDINGS REPORT</reportType>
    </coverPage>
    <summaryPage><tableEntryTotal>4</tableEntryTotal><tableValueTotal>2349000</tableValueTotal></summaryPage>
  </formData>
</edgarSubmission>`;

export const FORM4_MIXED = `<?xml version="1.0"?>
<ownershipDocument>
  <schemaVersion>X0508</schemaVersion>
  <documentType>4</documentType>
  <periodOfReport>2025-05-02</periodOfReport>
  <aff10b5One>0</aff10b5One>
  <issuer><issuerCik>0000320193</issuerCik><issuerName>Apple Inc.</issuerName><issuerTradingSymbol>aapl</issuerTradingSymbol></issuer>
  <reportingOwner>
    <reportingOwnerId><rptOwnerCik>0001234567</rptOwnerCik><rptOwnerName>Doe Jane</rptOwnerName></reportingOwnerId>
    <reportingOwnerRelationship><isDirector>0</isDirector><isOfficer>1</isOfficer><officerTitle>Chief Financial Officer</officerTitle><isTenPercentOwner>0</isTenPercentOwner><isOther>0</isOther></reportingOwnerRelationship>
  </reportingOwner>
  <reportingOwner>
    <reportingOwnerId><rptOwnerCik>0007654321</rptOwnerCik><rptOwnerName>Doe Family Trust</rptOwnerName></reportingOwnerId>
    <reportingOwnerRelationship><isOther>1</isOther><otherText>Trust</otherText></reportingOwnerRelationship>
  </reportingOwner>
  <nonDerivativeTable>
    <nonDerivativeTransaction>
      <securityTitle><value>Common Stock</value></securityTitle>
      <transactionDate><value>2025-05-01</value></transactionDate>
      <transactionCoding><transactionFormType>4</transactionFormType><transactionCode>P</transactionCode><equitySwapInvolved>0</equitySwapInvolved></transactionCoding>
      <transactionAmounts><transactionShares><value>1,000</value></transactionShares><transactionPricePerShare><value>201.25</value><footnoteId id="F1"/></transactionPricePerShare><transactionAcquiredDisposedCode><value>A</value></transactionAcquiredDisposedCode></transactionAmounts>
      <postTransactionAmounts><sharesOwnedFollowingTransaction><value>51000</value></sharesOwnedFollowingTransaction></postTransactionAmounts>
      <ownershipNature><directOrIndirectOwnership><value>D</value></directOrIndirectOwnership></ownershipNature>
    </nonDerivativeTransaction>
    <nonDerivativeTransaction>
      <securityTitle><value>Common Stock</value></securityTitle>
      <transactionDate><value>2025-05-02</value></transactionDate>
      <transactionCoding><transactionFormType>4</transactionFormType><transactionCode>F</transactionCode></transactionCoding>
      <transactionAmounts><transactionShares><value>400</value></transactionShares><transactionPricePerShare><value>202</value></transactionPricePerShare><transactionAcquiredDisposedCode><value>D</value></transactionAcquiredDisposedCode></transactionAmounts>
      <postTransactionAmounts><sharesOwnedFollowingTransaction><value>50600</value></sharesOwnedFollowingTransaction></postTransactionAmounts>
      <ownershipNature><directOrIndirectOwnership><value>D</value></directOrIndirectOwnership></ownershipNature>
    </nonDerivativeTransaction>
    <nonDerivativeTransaction>
      <securityTitle><value>Common Stock</value></securityTitle>
      <transactionDate><value>2025-05-02</value></transactionDate>
      <transactionCoding><transactionFormType>4</transactionFormType><transactionCode>A</transactionCode></transactionCoding>
      <transactionAmounts><transactionShares><value>5000</value></transactionShares><transactionPricePerShare><footnoteId id="F2"/></transactionPricePerShare><transactionAcquiredDisposedCode><value>A</value></transactionAcquiredDisposedCode></transactionAmounts>
      <postTransactionAmounts><sharesOwnedFollowingTransaction><value>55600</value></sharesOwnedFollowingTransaction></postTransactionAmounts>
      <ownershipNature><directOrIndirectOwnership><value>I</value></directOrIndirectOwnership><natureOfOwnership><value>By trust</value></natureOfOwnership></ownershipNature>
    </nonDerivativeTransaction>
  </nonDerivativeTable>
  <derivativeTable>
    <derivativeTransaction>
      <securityTitle><value>Call Option</value></securityTitle>
      <conversionOrExercisePrice><value>180</value></conversionOrExercisePrice>
      <transactionDate><value>2025-05-02</value></transactionDate>
      <transactionCoding><transactionFormType>4</transactionFormType><transactionCode>P</transactionCode></transactionCoding>
      <transactionAmounts><transactionShares><value>10</value></transactionShares><transactionPricePerShare><value>25</value></transactionPricePerShare><transactionAcquiredDisposedCode><value>A</value></transactionAcquiredDisposedCode></transactionAmounts>
      <postTransactionAmounts><sharesOwnedFollowingTransaction><value>10</value></sharesOwnedFollowingTransaction></postTransactionAmounts>
      <ownershipNature><directOrIndirectOwnership><value>D</value></directOrIndirectOwnership></ownershipNature>
    </derivativeTransaction>
  </derivativeTable>
  <footnotes><footnote id="F1">Weighted average price.</footnote><footnote id="F2">RSU grant.</footnote></footnotes>
</ownershipDocument>`;

export const SUBMISSIONS = (o: { cik: string; name: string; rows: { acc: string; form: string; filed: string; report: string; accepted: string; doc: string; items?: string }[] }) => ({
  cik: o.cik,
  name: o.name,
  tickers: ['TEST'],
  filings: {
    recent: {
      accessionNumber: o.rows.map((r) => r.acc),
      filingDate: o.rows.map((r) => r.filed),
      reportDate: o.rows.map((r) => r.report),
      acceptanceDateTime: o.rows.map((r) => r.accepted),
      form: o.rows.map((r) => r.form),
      primaryDocument: o.rows.map((r) => r.doc),
      items: o.rows.map((r) => r.items ?? ''),
    },
  },
});
