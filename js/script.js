(() => {
    "use strict";

    const $ = (selector, root = document) => root.querySelector(selector);
    const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
    const LOCAL_KEY = "sakura_appointments_v2";
    const DEMO_ADMIN_CODE = "2468";
    const API_URL = "/api/appointments";
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

    const state = {
        storageMode: "local",
        adminSecret: "",
        adminFilter: "all",
        bookings: [],
        occupied: [],
        selectedTime: "",
        reviewIndex: 0,
        submittedAt: Date.now()
    };

    const menuButton = $(".menu-button");
    const navMenu = $(".nav-menu");
    const bookingDialog = $("#bookingDialog");
    const adminDialog = $("#adminDialog");
    const bookingForm = $("#bookingForm");
    const bookingSuccess = $("#bookingSuccess");
    const bookingService = $("#bookingService");
    const bookingDate = $("#bookingDate");
    const bookingSpecialist = $("#bookingSpecialist");
    const timeSlots = $("#timeSlots");
    const timeHelper = $("#timeHelper");
    const timeError = $("#timeError");

    function setDialogState(isOpen) {
        document.body.classList.toggle("dialog-open", isOpen);
    }

    function openDialog(dialog) {
        if (!dialog) return;
        if (typeof dialog.showModal === "function") dialog.showModal();
        else dialog.setAttribute("open", "");
        setDialogState(true);
    }

    function closeDialog(dialog) {
        if (!dialog) return;
        if (typeof dialog.close === "function") dialog.close();
        else dialog.removeAttribute("open");
        if (!bookingDialog?.open && !adminDialog?.open) setDialogState(false);
    }

    function toast(message) {
        const region = $("#toastRegion");
        if (!region) return;
        const item = document.createElement("div");
        item.className = "toast";
        item.textContent = message;
        region.append(item);
        window.setTimeout(() => item.remove(), 3600);
    }

    function getLocalBookings() {
        try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || "[]"); }
        catch { return []; }
    }

    function setLocalBookings(items) {
        localStorage.setItem(LOCAL_KEY, JSON.stringify(items));
        state.bookings = items;
        state.occupied = items.filter(item => item.status === "approved").map(item => ({
            date: item.date,
            time: item.time,
            duration: SERVICES[item.service] || 60
        }));
    }

    async function requestApi(options = {}) {
        const response = await fetch(API_URL, {
            method: options.method || "GET",
            headers: { "Content-Type": "application/json", ...(options.secret ? { "x-admin-secret": options.secret } : {}) },
            body: options.body ? JSON.stringify(options.body) : undefined,
            cache: "no-store"
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            const error = new Error(data.message || "İşlem tamamlanamadı.");
            error.status = response.status;
            error.data = data;
            throw error;
        }
        return data;
    }

    async function loadAvailability() {
        try {
            const data = await requestApi();
            if (data.configured) {
                state.storageMode = "remote";
                state.occupied = Array.isArray(data.occupied) ? data.occupied : [];
                return;
            }
        } catch { /* Local preview uses demo storage. */ }
        state.storageMode = "local";
        setLocalBookings(getLocalBookings());
    }

    function isoDate(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, "0");
        const day = String(date.getDate()).padStart(2, "0");
        return `${year}-${month}-${day}`;
    }

    function formatDate(value) {
        if (!value) return "—";
        return new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "long", year: "numeric", weekday: "long" }).format(new Date(`${value}T12:00:00`));
    }

    function configureDateInput() {
        if (!bookingDate) return;
        const today = new Date();
        const max = new Date();
        max.setDate(max.getDate() + 60);
        bookingDate.min = isoDate(today);
        bookingDate.max = isoDate(max);
    }

    function timeToMinutes(value) {
        const [hours, minutes] = String(value).split(":").map(Number);
        return hours * 60 + minutes;
    }

    function bookingsOverlap(first, second) {
        if (first.date !== second.date) return false;
        const firstStart = timeToMinutes(first.time);
        const secondStart = timeToMinutes(second.time);
        const firstEnd = firstStart + (SERVICES[first.service] || Number(first.duration) || 60);
        const secondEnd = secondStart + (SERVICES[second.service] || Number(second.duration) || 60);
        return firstStart < secondEnd && firstEnd > secondStart;
    }

    function availableSlotsFor(dateValue) {
        if (!dateValue) return [];
        const date = new Date(`${dateValue}T12:00:00`);
        const day = date.getDay();
        if (day === 0) return [];
        const base = day === 6 ? SATURDAY_SLOTS : WEEKDAY_SLOTS;
        const now = new Date();
        const selectedDuration = SERVICES[bookingService?.value] || 60;
        const closingMinutes = day === 6 ? 18 * 60 : 19 * 60;
        return base.filter(time => {
            const [hour, minute] = time.split(":").map(Number);
            const slotDate = new Date(`${dateValue}T00:00:00`);
            slotDate.setHours(hour, minute, 0, 0);
            const start = timeToMinutes(time);
            const end = start + selectedDuration;
            const overlaps = state.occupied.some(item => {
                if (item.date !== dateValue) return false;
                const occupiedStart = timeToMinutes(item.time);
                const occupiedEnd = occupiedStart + (Number(item.duration) || 60);
                return start < occupiedEnd && end > occupiedStart;
            });
            return slotDate > now && end <= closingMinutes && !overlaps;
        });
    }

    async function renderTimeSlots() {
        if (!timeSlots) return;
        state.selectedTime = "";
        timeSlots.innerHTML = "";
        updateSummary();
        const service = bookingService.value;
        const dateValue = bookingDate.value;
        if (!service || !dateValue) {
            timeHelper.textContent = "Önce hizmet ve tarih seçin.";
            return;
        }
        await loadAvailability();
        const date = new Date(`${dateValue}T12:00:00`);
        if (date.getDay() === 0) {
            timeHelper.textContent = "Pazar günleri stüdyomuz kapalıdır. Lütfen başka bir gün seçin.";
            return;
        }
        const openSlots = availableSlotsFor(dateValue);
        timeHelper.textContent = openSlots.length ? "Seçilebilir saatler aşağıda gösteriliyor." : "Bu tarihte uygun saat kalmadı. Başka bir gün deneyin.";
        const allSlots = date.getDay() === 6 ? SATURDAY_SLOTS : WEEKDAY_SLOTS;
        allSlots.forEach(time => {
            const label = document.createElement("label");
            label.className = "time-slot";
            const input = document.createElement("input");
            input.type = "radio";
            input.name = "time";
            input.value = time;
            input.disabled = !openSlots.includes(time);
            const visual = document.createElement("span");
            visual.textContent = time;
            input.addEventListener("change", () => { state.selectedTime = time; timeError.textContent = ""; updateSummary(); });
            label.append(input, visual);
            timeSlots.append(label);
        });
    }

    function updateSummary() {
        const service = bookingService?.value || "";
        $("#summaryService").textContent = service || "Henüz hizmet seçilmedi";
        $("#summaryDate").textContent = bookingDate?.value ? formatDate(bookingDate.value) : "—";
        $("#summaryTime").textContent = state.selectedTime || "—";
        $("#summaryDuration").textContent = service ? `${SERVICES[service] || 60} dk.` : "—";
    }

    function resetBookingForm() {
        bookingForm?.reset();
        state.selectedTime = "";
        state.submittedAt = Date.now();
        if (bookingForm) bookingForm.hidden = false;
        if (bookingSuccess) bookingSuccess.hidden = true;
        if (timeSlots) timeSlots.innerHTML = "";
        if (timeHelper) timeHelper.textContent = "Önce hizmet ve tarih seçin.";
        $$(".field", bookingForm).forEach(field => { field.classList.remove("invalid"); const error = $(".field-error", field); if (error) error.textContent = ""; });
        if (timeError) timeError.textContent = "";
        $("#bookingStatus").textContent = "";
        updateSummary();
    }

    async function showBooking(serviceChoice = "") {
        resetBookingForm();
        if (serviceChoice && SERVICES[serviceChoice]) bookingService.value = serviceChoice;
        configureDateInput();
        updateSummary();
        await loadAvailability();
        openDialog(bookingDialog);
        window.setTimeout(() => bookingService?.focus(), 80);
    }

    function setFieldError(input, message) {
        const field = input.closest(".field");
        if (!field) return;
        field.classList.toggle("invalid", Boolean(message));
        const error = $(".field-error", field);
        if (error) error.textContent = message;
    }

    function validateBooking(formData) {
        let valid = true;
        const fields = [bookingService, bookingDate, bookingForm.elements.name, bookingForm.elements.phone];
        fields.forEach(input => setFieldError(input, ""));
        if (!formData.get("service")) { setFieldError(bookingService, "Lütfen bir hizmet seçin."); valid = false; }
        if (!formData.get("date")) { setFieldError(bookingDate, "Lütfen bir tarih seçin."); valid = false; }
        const name = String(formData.get("name") || "").trim();
        if (name.length < 3) { setFieldError(bookingForm.elements.name, "Ad soyad en az 3 karakter olmalı."); valid = false; }
        const digits = String(formData.get("phone") || "").replace(/\D/g, "");
        if (digits.length < 10 || digits.length > 12) { setFieldError(bookingForm.elements.phone, "Geçerli bir telefon numarası girin."); valid = false; }
        if (!state.selectedTime) { timeError.textContent = "Lütfen uygun bir saat seçin."; valid = false; }
        if (!bookingForm.elements.privacy.checked) { toast("Devam etmek için veri kullanım onayını işaretleyin."); valid = false; }
        return valid;
    }

    async function createBooking(payload) {
        if (state.storageMode === "remote") {
            const data = await requestApi({ method: "POST", body: payload });
            return data.appointment;
        }
        const current = getLocalBookings();
        const appointment = { ...payload, id: crypto.randomUUID ? crypto.randomUUID() : `sakura-${Date.now()}`, status: "pending", createdAt: new Date().toISOString() };
        current.unshift(appointment);
        setLocalBookings(current);
        return appointment;
    }

    async function submitBooking(event) {
        event.preventDefault();
        const formData = new FormData(bookingForm);
        if (formData.get("website")) return;
        if (Date.now() - state.submittedAt < 1500) return;
        if (!validateBooking(formData)) return;
        const submitButton = $(".booking-submit", bookingForm);
        submitButton.disabled = true;
        submitButton.textContent = "Gönderiliyor…";
        $("#bookingStatus").textContent = "";
        const payload = {
            service: String(formData.get("service")), date: String(formData.get("date")), time: state.selectedTime,
            specialist: String(formData.get("specialist") || "Fark etmez"), name: String(formData.get("name")).trim(),
            phone: String(formData.get("phone")).trim(), email: String(formData.get("email") || "").trim(), note: String(formData.get("note") || "").trim()
        };
        try {
            const appointment = await createBooking(payload);
            bookingForm.hidden = true;
            bookingSuccess.hidden = false;
            $("#successSummary").innerHTML = `<strong>${escapeHtml(appointment.service)}</strong><br>${escapeHtml(formatDate(appointment.date))} · ${escapeHtml(appointment.time)}<br>Durum: Onay bekliyor`;
            toast("Randevu talebiniz başarıyla alındı.");
        } catch (error) {
            $("#bookingStatus").textContent = error.status === 409 ? "Bu saat az önce doldu. Lütfen başka bir saat seçin." : "Talep gönderilemedi. Lütfen tekrar deneyin.";
            await renderTimeSlots();
        } finally {
            submitButton.disabled = false;
            submitButton.innerHTML = "Randevu Talebi Gönder <span>→</span>";
        }
    }

    function escapeHtml(value) {
        return String(value ?? "").replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
    }

    function statusLabel(status) { return status === "approved" ? "Onaylandı" : status === "rejected" ? "Reddedildi" : "Bekliyor"; }

    async function adminLogin(secret) {
        try {
            const data = await requestApi({ secret });
            if (data.configured) {
                state.storageMode = "remote";
                state.adminSecret = secret;
                state.bookings = data.appointments || [];
                sessionStorage.setItem("sakura_admin_session", secret);
                return true;
            }
        } catch (error) {
            if (error.status === 401) return false;
        }
        if (secret !== DEMO_ADMIN_CODE) return false;
        state.storageMode = "local";
        state.adminSecret = secret;
        state.bookings = getLocalBookings();
        return true;
    }

    async function refreshAdminBookings() {
        if (state.storageMode === "remote") {
            const data = await requestApi({ secret: state.adminSecret });
            state.bookings = data.appointments || [];
        } else state.bookings = getLocalBookings();
        renderAdminBookings();
    }

    function renderAdminBookings() {
        const list = $("#appointmentList");
        if (!list) return;
        $("#pendingCount").textContent = state.bookings.filter(item => item.status === "pending").length;
        $("#approvedCount").textContent = state.bookings.filter(item => item.status === "approved").length;
        $("#rejectedCount").textContent = state.bookings.filter(item => item.status === "rejected").length;
        const filtered = state.adminFilter === "all" ? state.bookings : state.bookings.filter(item => item.status === state.adminFilter);
        if (!filtered.length) { list.innerHTML = `<div class="empty-appointments">Bu filtrede henüz randevu talebi yok.</div>`; return; }
        list.innerHTML = filtered.map(item => `<article class="appointment-item" data-id="${escapeHtml(item.id)}"><div class="appointment-customer"><span class="status-pill status-${escapeHtml(item.status)}">${statusLabel(item.status)}</span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.service)} · ${escapeHtml(item.specialist || "Fark etmez")}</small><small>${escapeHtml(item.phone)}${item.email ? ` · ${escapeHtml(item.email)}` : ""}</small></div><div class="appointment-time"><strong>${escapeHtml(formatDate(item.date))}</strong><small>${escapeHtml(item.time)} · ${SERVICES[item.service] || 60} dk.</small>${item.note ? `<small>Not: ${escapeHtml(item.note)}</small>` : ""}</div><div class="appointment-actions">${item.status === "pending" ? `<button type="button" data-appointment-status="approved">Onayla</button><button type="button" class="reject" data-appointment-status="rejected">Reddet</button>` : `<span class="status-pill status-${escapeHtml(item.status)}">${statusLabel(item.status)}</span>`}</div></article>`).join("");
    }

    async function updateAppointmentStatus(id, status) {
        if (state.storageMode === "remote") {
            await requestApi({ method: "PATCH", secret: state.adminSecret, body: { id, status } });
        } else {
            const current = getLocalBookings();
            const target = current.find(item => item.id === id);
            if (!target) throw new Error("Randevu bulunamadı.");
            if (status === "approved" && current.some(item => item.id !== id && item.status === "approved" && bookingsOverlap(target, item))) throw new Error("Bu saat başka bir randevu ile çakışıyor.");
            target.status = status;
            target.updatedAt = new Date().toISOString();
            setLocalBookings(current);
        }
        await refreshAdminBookings();
        await loadAvailability();
        toast(status === "approved" ? "Randevu onaylandı; saat artık dolu görünüyor." : "Randevu talebi reddedildi.");
    }

    function showAdminPanel() {
        $("#adminLogin").hidden = true;
        $("#adminPanel").hidden = false;
        refreshAdminBookings().catch(() => toast("Randevular yüklenemedi."));
    }

    function resetAdmin() {
        state.adminSecret = "";
        sessionStorage.removeItem("sakura_admin_session");
        $("#adminLogin").hidden = false;
        $("#adminPanel").hidden = true;
        $("#adminLoginForm").reset();
        $("#adminLoginStatus").textContent = "";
    }

    function initNavigation() {
        menuButton?.addEventListener("click", () => {
            const isOpen = navMenu.classList.toggle("active");
            menuButton.classList.toggle("active", isOpen);
            menuButton.setAttribute("aria-expanded", String(isOpen));
            menuButton.setAttribute("aria-label", isOpen ? "Menüyü kapat" : "Menüyü aç");
        });
        $$(".nav-menu a").forEach(link => link.addEventListener("click", () => {
            navMenu?.classList.remove("active"); menuButton?.classList.remove("active"); menuButton?.setAttribute("aria-expanded", "false"); menuButton?.setAttribute("aria-label", "Menüyü aç");
        }));
        const sections = $$("main section[id]");
        if ("IntersectionObserver" in window) {
            const observer = new IntersectionObserver(entries => entries.forEach(entry => {
                if (!entry.isIntersecting) return;
                $$(".nav-menu a").forEach(link => link.classList.toggle("active", link.getAttribute("href") === `#${entry.target.id}`));
            }), { rootMargin: "-40% 0px -55%" });
            sections.forEach(section => observer.observe(section));
        }
    }

    function initHeroParallax() {
        const hero = $(".hero");
        const background = $(".hero-background");
        if (!hero || !background) return;
        const desktopPointer = window.matchMedia("(min-width: 1051px) and (pointer: fine)");
        hero.addEventListener("mousemove", event => {
            if (!desktopPointer.matches) return;
            const rect = hero.getBoundingClientRect();
            const x = (event.clientX - rect.left) / rect.width - .5;
            const y = (event.clientY - rect.top) / rect.height - .5;
            background.style.transform = `scale(1.025) translate(${x * 5}px, ${y * 4}px)`;
        });
        hero.addEventListener("mouseleave", () => { background.style.transform = "scale(1.015)"; });
    }

    function initRevealAndCounters() {
        const revealItems = $$(".reveal");
        if (!("IntersectionObserver" in window)) { revealItems.forEach(item => item.classList.add("visible")); return; }
        const observer = new IntersectionObserver(entries => entries.forEach(entry => {
            if (!entry.isIntersecting) return;
            entry.target.classList.add("visible");
            const counter = entry.target.querySelector("[data-counter]");
            if (counter && !counter.dataset.done) animateCounter(counter);
            observer.unobserve(entry.target);
        }), { threshold: .12 });
        revealItems.forEach(item => observer.observe(item));
    }

    function animateCounter(element) {
        element.dataset.done = "true";
        const target = Number(element.dataset.counter);
        const start = performance.now();
        const duration = 1200;
        const step = now => {
            const progress = Math.min((now - start) / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3);
            element.textContent = Math.round(target * eased).toLocaleString("tr-TR");
            if (progress < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
    }

    function initReviews() {
        const track = $(".review-track");
        const cards = $$(".review-card");
        if (!track || !cards.length) return;
        const update = () => {
            const cardWidth = cards[0].getBoundingClientRect().width;
            const gap = parseFloat(getComputedStyle(track).gap) || 0;
            track.style.transform = `translateX(-${state.reviewIndex * (cardWidth + gap)}px)`;
        };
        $("[data-review-next]")?.addEventListener("click", () => { state.reviewIndex = (state.reviewIndex + 1) % cards.length; update(); });
        $("[data-review-prev]")?.addEventListener("click", () => { state.reviewIndex = (state.reviewIndex - 1 + cards.length) % cards.length; update(); });
        window.addEventListener("resize", update, { passive: true });
    }

    function initFaq() {
        $$(".faq-list details").forEach(detail => detail.addEventListener("toggle", () => {
            if (!detail.open) return;
            $$(".faq-list details").forEach(other => { if (other !== detail) other.open = false; });
        }));
    }

    function initDialogs() {
        $$("[data-booking-open]").forEach(button => button.addEventListener("click", () => showBooking(button.dataset.serviceChoice || "")));
        $$("[data-dialog-close]").forEach(button => button.addEventListener("click", () => closeDialog(bookingDialog)));
        $("[data-booking-reset]")?.addEventListener("click", resetBookingForm);
        bookingDialog?.addEventListener("click", event => { if (event.target === bookingDialog) closeDialog(bookingDialog); });
        bookingDialog?.addEventListener("close", () => setDialogState(Boolean(adminDialog?.open)));
        bookingService?.addEventListener("change", () => { updateSummary(); renderTimeSlots(); });
        bookingDate?.addEventListener("change", renderTimeSlots);
        bookingForm?.addEventListener("submit", submitBooking);

        $$("[data-admin-open]").forEach(button => button.addEventListener("click", () => { resetAdmin(); openDialog(adminDialog); $("#adminSecret")?.focus(); }));
        $("[data-admin-close]")?.addEventListener("click", () => closeDialog(adminDialog));
        adminDialog?.addEventListener("click", event => { if (event.target === adminDialog) closeDialog(adminDialog); });
        adminDialog?.addEventListener("close", () => setDialogState(Boolean(bookingDialog?.open)));
        $("#adminLoginForm")?.addEventListener("submit", async event => {
            event.preventDefault();
            const secret = $("#adminSecret").value.trim();
            $("#adminLoginStatus").textContent = "Kontrol ediliyor…";
            const ok = await adminLogin(secret);
            if (!ok) { $("#adminLoginStatus").textContent = "Yönetici kodu hatalı."; return; }
            $("#adminLoginStatus").textContent = "";
            showAdminPanel();
        });
        $("#adminLogout")?.addEventListener("click", resetAdmin);
        $("#refreshAppointments")?.addEventListener("click", () => refreshAdminBookings().catch(() => toast("Randevular yenilenemedi.")));
        $$("[data-admin-filter]").forEach(button => button.addEventListener("click", () => {
            state.adminFilter = button.dataset.adminFilter;
            $$("[data-admin-filter]").forEach(item => item.classList.toggle("active", item === button));
            renderAdminBookings();
        }));
        $("#appointmentList")?.addEventListener("click", event => {
            const button = event.target.closest("[data-appointment-status]");
            if (!button) return;
            const item = button.closest("[data-id]");
            updateAppointmentStatus(item.dataset.id, button.dataset.appointmentStatus).catch(error => toast(error.message || "İşlem tamamlanamadı."));
        });
    }

    function initNewsletter() {
        $("#newsletterForm")?.addEventListener("submit", event => { event.preventDefault(); event.currentTarget.reset(); toast("Teşekkürler! Sakura notlarına kaydınız alındı."); });
    }

    async function init() {
        configureDateInput();
        initNavigation();
        initHeroParallax();
        initRevealAndCounters();
        initReviews();
        initFaq();
        initDialogs();
        initNewsletter();
        await loadAvailability();
        if (new URLSearchParams(location.search).get("booking") === "open") showBooking();
    }

    init();
})();
