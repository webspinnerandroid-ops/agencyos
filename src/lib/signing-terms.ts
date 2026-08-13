// Client-safe module: the legal Terms of Service sections used on the public
// signing page and the archived signed agreement. Kept free of any server-only
// imports so client components can render it directly.

/** The legal Terms of Service section used on every signed agreement. */
export const SIGNING_TERMS: { heading: string; body: string }[] = [
  {
    heading: "Services",
    body: "The agency will provide the services described in the proposal for the monthly fee stated. Services begin once this agreement is signed and the initial payment is received.",
  },
  {
    heading: "Payment",
    body: "Fees are billed monthly in advance. Payment is due within 15 days of the invoice date. Late payments may pause services until the account is current.",
  },
  {
    heading: "Term & Cancellation",
    body: "This agreement is a month-to-month engagement. Either party may cancel by providing at least 60 days written notice before the next billing cycle. Fees already paid for the notice period are non-refundable.",
  },
  {
    heading: "Client Responsibilities",
    body: "The client agrees to provide timely access to website, analytics, and brand assets needed to perform the services, and to approve content within a reasonable timeframe so deadlines can be met.",
  },
  {
    heading: "Intellectual Property",
    body: "Work product created for the client becomes the client's property upon full payment. The agency retains the right to use non-confidential results in its portfolio.",
  },
  {
    heading: "Third-Party Tools & Platforms",
    body: "Services rely on third-party platforms (search engines, social networks, CMSes, ad platforms). The agency is not liable for changes, outages, or policy updates made by those platforms.",
  },
  {
    heading: "Results Disclaimer",
    body: "SEO and marketing results depend on market conditions and third-party algorithm changes; projected outcomes are estimates and not guarantees.",
  },
  {
    heading: "Limitation of Liability",
    body: "The agency's total liability under this agreement is limited to fees paid in the three months preceding a claim. Neither party is liable for indirect or consequential damages.",
  },
  {
    heading: "Confidentiality",
    body: "Both parties will keep confidential any proprietary information shared during the engagement and will not disclose it to third parties.",
  },
  {
    heading: "Governing Law",
    body: "This agreement is governed by the laws of the agency's jurisdiction, and the parties consent to its courts for any disputes.",
  },
];
