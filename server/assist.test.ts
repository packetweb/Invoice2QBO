import assert from "node:assert/strict"
import { pickShipToEmail, shipToEmailsFromText, stitchAddress, toParse } from "./assist.ts"

const poText = `
Purchase Order 9080162376
Please email invoices to americas-apscanning@keysight.com
Buyer: jane.buyer@keysight.com
Bill To: Keysight Technologies
1400 Fountaingrove Pkwy
Deliver To: Chris Chen chris.chen@keysight.com
Item TP250LB qty 2
`

assert.equal(pickShipToEmail(poText, "Chris Chen", "americas-apscanning@keysight.com"), "chris.chen@keysight.com")
assert.deepEqual(shipToEmailsFromText(poText, "Chris Chen")[0], "chris.chen@keysight.com")

const keysightLine = `
Please email invoices to americas-apscanning@keysight.com
Ship To
KEYSIGHT TECHNOLOGIES, INC.
1400 FOUNTAINGROVE PARKWAY, DOCK 2LS
SANTA ROSA CA 95403-1738
United States
Requestor Deliver to     TRUJILLO, ANTHONY JOSEPH
Email                    anthony.trujillo2@keysight.com
Telephone                1719-5228063
`
assert.equal(
  pickShipToEmail(keysightLine, "TRUJILLO, ANTHONY JOSEPH", "americas-apscanning@keysight.com"),
  "anthony.trujillo2@keysight.com",
)

const stitched = stitchAddress("1400 Fountaingrove Pkwy", "Santa Rosa", "CA", "95403", "USA")
assert.match(stitched, /1400 Fountaingrove Pkwy/)
assert.match(stitched, /Santa Rosa, CA 95403/)
assert.match(stitched, /USA/)

const parsed = toParse(
  {
    poNumber: "9080162376",
    contactName: "TRUJILLO, ANTHONY JOSEPH",
    email: "americas-apscanning@keysight.com",
    shippingAddress: "1400 Fountaingrove Pkwy",
    billingAddress: "Keysight AP\nSanta Rosa",
    city: "Santa Rosa",
    state: "CA",
    country: "USA",
    zip: "95403",
    comments: "Need by 10/1",
    items: [{ partNumber: "TP250LB", description: "probe", quantity: 2, unitPrice: 1 }],
  },
  keysightLine,
)
assert.equal(parsed.email, "anthony.trujillo2@keysight.com")
assert.match(parsed.comments, /anthony.trujillo2@keysight.com/)
assert.doesNotMatch(parsed.comments, /americas-apscanning/)
assert.match(parsed.shippingAddress, /Santa Rosa, CA 95403/)
assert.equal(parsed.billingAddress, "Keysight AP\nSanta Rosa")

console.log("assist.test.ts: all checks passed")
