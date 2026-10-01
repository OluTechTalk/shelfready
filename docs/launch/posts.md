# Launch posts — drafts

Links: demo https://shelfready-ashen.vercel.app · case study https://shelfready-ashen.vercel.app/case-study · repo https://github.com/OluTechTalk/shelfready · Loom: _add after recording_

## LinkedIn

AI assistants are starting to shop for people. But they can only recommend what they can understand — and most product catalogs were written for humans scrolling a page.

I built ShelfReady to close that gap for a Shopify store, end to end, the way I'd run a customer engagement:

🔍 Audit — scored 150 products on what an agent needs (structured facts, answerable descriptions, clean variants). Baseline 94/100, with 11 products effectively invisible.
🛠️ Fix, with a human in the loop — AI proposes fixes grounded only in each product's own data; anything it can't prove goes to the merchant. A person approves every change. Result: 98/100, zero invisible products.
🤖 Open the store to agents — an MCP server any agent (including Claude) can use to search, check live stock and hand back a real checkout link. It never touches payment.
📊 Measure — 60 shopping tasks × 3 runs on the messy vs fixed catalog: 98.9% → 99.4% right product, 0 wrong products.

What surprised me: my first eval got *worse* after the fixes. The culprit was my own search tool, not the data. Agent-readiness is the data AND the interface agents use.

Try the shopping agent yourself: [demo link]
Case study (decisions, costs, what broke): [case study link]
Code: [repo link]

#AI #AgenticCommerce #Shopify #MCP

## X / Bluesky (thread)

1/ AI agents are starting to shop for people. Most catalogs aren't built for them. I built ShelfReady: audit a Shopify store for agent-readiness, fix it with AI + human approval, and open it to agents over MCP. Live demo 👇 [demo link]

2/ The fixer never invents facts: every value needs a quote from the product's own text, checked in code. Can't prove it → it goes to the merchant. 105 fixes applied; readiness 94 → 98.

3/ Eval: 60 tasks × 3 runs, messy vs fixed catalog. 98.9% → 99.4% right product, 0 wrong. Biggest lesson: my first run got worse after the fixes — the search tool was the problem. Data AND tools. Write-up: [case study link]
