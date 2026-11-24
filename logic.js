// Funzioni pure (senza Firebase), così si possono testare facilmente.

// Chiave per ricordare lo smistamento: prime 3 parole significative della descrizione.
const STOP = new Set(["pos", "pagamento", "carta", "addebito", "acquisto", "del", "di", "da", "il", "la", "presso", "op", "sdd", "bancomat", "contactless", "web", "online"]);
export function normKey(desc) {
  const words = String(desc || "").toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z ]+/g, " ").split(/\s+/)
    .filter(w => w.length > 1 && !STOP.has(w));
  return words.slice(0, 3).join(" ");
}

// Quota (in %) del primo membro per una spesa condivisa.
export function computeShare(x, H) {
  if (x.split !== null && x.split !== undefined && x.split !== "") return +x.split;
  const byCat = H?.splitByCategory?.[x.category];
  if (byCat !== undefined) return +byCat;
  return +(H?.splitDefault ?? 50);
}

// Saldo del mese: net1 > 0 vuol dire che il secondo deve net1 al primo.
export function computeBalance(items, H, m1, m2) {
  let share1 = 0, share2 = 0, paid1 = 0, paid2 = 0;
  for (const x of items) {
    const p = computeShare(x, H) / 100;
    const s1 = x.amount * p;
    share1 += s1; share2 += x.amount - s1;
    if (x.paidBy === m1) paid1 += x.amount;
    else if (x.paidBy === m2) paid2 += x.amount;
  }
  const r = n => Math.round(n * 100) / 100;
  return { share1: r(share1), share2: r(share2), paid1: r(paid1), paid2: r(paid2), net1: r(paid1 - share1) };
}

export function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
export function shiftMonth(m, delta) {
  const [y, mo] = m.split("-").map(Number);
  const d = new Date(y, mo - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
export function monthLabel(m) {
  const [y, mo] = m.split("-").map(Number);
  return new Date(y, mo - 1, 1).toLocaleDateString("it-IT", { month: "long", year: "numeric" });
}
