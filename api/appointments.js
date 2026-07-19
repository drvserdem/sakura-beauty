const KEY = "sakura:appointments:v1";
const SERVICES = {
    "Cilt Bakımı": 75,
    "Kalıcı Makyaj": 120,
    "Kaş ve Kirpik": 60,
    "Hydrafacial": 60,
    "İpek Kirpik": 90,
    "Ücretsiz Ön Görüşme": 20
};
const WEEKDAY_SLOTS = ["09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00"];
const SATURDAY_SLOTS = ["10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00"];

function configured() {
    return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN && process.env.ADMIN_SECRET);
}

async function redis(command) {
    const response = await fetch(process.env.UPSTASH_REDIS_REST_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify(command)
    });
    if (!response.ok) throw new Error("Veri servisine ulaşılamadı.");
    const data = await response.json();
    return data.result;
}

async function readAppointments() {
    const value = await redis(["GET", KEY]);
    if (!value) return [];
    try { return JSON.parse(value); } catch { return []; }
}

async function writeAppointments(items) {
    await redis(["SET", KEY, JSON.stringify(items)]);
}

function clean(value, limit = 180) {
    return String(value || "").trim().slice(0, limit);
}

function send(res, status, data) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.status(status).json(data);
}

function minutes(value) {
    const [hours, mins] = value.split(":").map(Number);
    return hours * 60 + mins;
}

function isValidSlot(appointment) {
    const date = new Date(`${appointment.date}T12:00:00Z`);
    if (Number.isNaN(date.getTime())) return false;
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const latest = new Date(today);
    latest.setUTCDate(latest.getUTCDate() + 60);
    if (date < today || date > latest) return false;
    const day = date.getUTCDay();
    if (day === 0) return false;
    const slots = day === 6 ? SATURDAY_SLOTS : WEEKDAY_SLOTS;
    if (!slots.includes(appointment.time)) return false;
    const closing = day === 6 ? 18 * 60 : 19 * 60;
    return minutes(appointment.time) + SERVICES[appointment.service] <= closing;
}

function hasApprovedConflict(appointments, candidate, ignoredId = "") {
    const candidateStart = minutes(candidate.time);
    const candidateEnd = candidateStart + (SERVICES[candidate.service] || 60);
    return appointments.some(item => {
        if (item.id === ignoredId || item.status !== "approved" || item.date !== candidate.date) return false;
        const itemStart = minutes(item.time);
        const itemEnd = itemStart + (SERVICES[item.service] || 60);
        return candidateStart < itemEnd && candidateEnd > itemStart;
    });
}

module.exports = async function handler(req, res) {
if (!configured()) {
    const missing = [
        "UPSTASH_REDIS_REST_URL",
        "UPSTASH_REDIS_REST_TOKEN",
        "ADMIN_SECRET"
    ].filter((name) => !process.env[name]);

    return send(res, 200, {
        configured: false,
        missing,
        occupied: []
    });
}    try {
        if (req.method === "GET") {
            const appointments = await readAppointments();
            const secret = req.headers["x-admin-secret"];
            if (secret) {
                if (secret !== process.env.ADMIN_SECRET) return send(res, 401, { message: "Yetkisiz işlem." });
                return send(res, 200, { configured: true, appointments });
            }
            const occupied = appointments.filter(item => item.status === "approved").map(item => ({
                date: item.date,
                time: item.time,
                duration: SERVICES[item.service] || 60
            }));
            return send(res, 200, { configured: true, occupied });
        }

        if (req.method === "POST") {
            const body = req.body || {};
            const appointment = {
                id: globalThis.crypto?.randomUUID?.() || `sakura-${Date.now()}-${Math.random().toString(16).slice(2)}`,
                service: clean(body.service, 80), date: clean(body.date, 10), time: clean(body.time, 5),
                specialist: clean(body.specialist, 80), name: clean(body.name, 100), phone: clean(body.phone, 30),
                email: clean(body.email, 120), note: clean(body.note, 500), status: "pending", createdAt: new Date().toISOString()
            };
            if (!SERVICES[appointment.service] || !/^\d{4}-\d{2}-\d{2}$/.test(appointment.date) || !/^\d{2}:\d{2}$/.test(appointment.time) || appointment.name.length < 3 || appointment.phone.replace(/\D/g, "").length < 10 || !isValidSlot(appointment)) return send(res, 400, { message: "Randevu bilgileri eksik veya geçersiz." });
            const appointments = await readAppointments();
            const occupied = hasApprovedConflict(appointments, appointment);
            if (occupied) return send(res, 409, { message: "Bu saat artık dolu." });
            appointments.unshift(appointment);
            await writeAppointments(appointments.slice(0, 2000));
            return send(res, 201, { configured: true, appointment });
        }

        if (req.method === "PATCH") {
            if (req.headers["x-admin-secret"] !== process.env.ADMIN_SECRET) return send(res, 401, { message: "Yetkisiz işlem." });
            const id = clean(req.body?.id, 120);
            const status = clean(req.body?.status, 20);
            if (!id || !["approved", "rejected"].includes(status)) return send(res, 400, { message: "Geçersiz işlem." });
            const appointments = await readAppointments();
            const target = appointments.find(item => item.id === id);
            if (!target) return send(res, 404, { message: "Randevu bulunamadı." });
            if (status === "approved" && hasApprovedConflict(appointments, target, id)) return send(res, 409, { message: "Bu saat başka bir randevu ile çakışıyor." });
            target.status = status;
            target.updatedAt = new Date().toISOString();
            await writeAppointments(appointments);
            return send(res, 200, { configured: true, appointment: target });
        }

        res.setHeader("Allow", "GET, POST, PATCH");
        return send(res, 405, { message: "Desteklenmeyen istek." });
    } catch {
        return send(res, 500, { message: "Randevu servisi geçici olarak kullanılamıyor." });
    }
}
