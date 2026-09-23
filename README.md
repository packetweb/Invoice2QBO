# PacketMicro PO to Invoice

Office tool: drop a customer PO PDF → Claude extracts the order → review → create a **QuickBooks Online Invoice** through CRM.

Not Quote Web. Estimates stay on Quote Web; this app only writes invoices.

## Run

```bash
cp .env.example .env   # or reuse CLAUDE_API_KEY from quote-web
npm install
npm run dev
```

Open [http://localhost:5176/](http://localhost:5176/).

CRM must be running on `:3000` and connected to QBO. Payment terms are matched live against QBO’s Term list (Net 30, Net 45, Prepaid, …).

## Flow

1. Drop PO PDF
2. Claude extracts PO number, customer, bill/ship, terms, lines
3. SKUs are matched to QBO items. Collect freight stays $0. Do not invent tax for international POs.
4. Confirm, then **Create QBO Invoice**
