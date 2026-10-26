// ===== 설정 =====
// Apps Script 웹 앱 배포 URL (…/exec)을 여기에 붙여넣으세요. README 참고.
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbydmdoh5bwJ3aoeffw5p8YXqIFhsaIqXAGEQbxjnVbW3QrSaeERIWlpBAHgvRFSTJBiZw/exec";
const MAX_PICKS = 2;
const OPERATING_DAYS = 26; // 월 영업일 가정

const $ = id => document.getElementById(id);
const scriptReady = !APPS_SCRIPT_URL.includes("REPLACE_WITH");

// ===== 디저트 2종 선택 =====
const boxes = Array.from(document.querySelectorAll('input[name="dessert"]'));
const statusEl = $("pickStatus");
const summaryEl = $("applySummary");

function selectedPicks() {
  return boxes.filter(b => b.checked).map(b => b.value);
}

function updatePicks(changed) {
  let picks = selectedPicks();
  if (picks.length > MAX_PICKS && changed) {
    changed.checked = false; // 3번째 선택은 취소
    picks = selectedPicks();
  }
  const n = picks.length;
  statusEl.textContent = n === MAX_PICKS
    ? `선택 완료: ${picks.join(" + ")}`
    : `디저트를 ${MAX_PICKS}종 선택해 주세요. (${n}/${MAX_PICKS})`;
  statusEl.classList.toggle("ok", n === MAX_PICKS);

  summaryEl.textContent = n === MAX_PICKS
    ? `선택한 디저트: ${picks.join(" + ")}`
    : "선택한 디저트: 위에서 2종을 먼저 골라 주세요.";
  summaryEl.classList.toggle("ok", n === MAX_PICKS);
}

boxes.forEach(b => b.addEventListener("change", () => updatePicks(b)));
updatePicks();

// ===== 회차 불러오기 (구글 시트 '회차' 탭) =====
const sessionSel = $("fSession");

async function loadSessions() {
  if (!scriptReady) {
    sessionSel.innerHTML = '<option value="">(관리자 설정 필요: APPS_SCRIPT_URL)</option>';
    setMsg("신청 연동이 아직 설정되지 않았습니다.", "err");
    $("submitBtn").disabled = true;
    return;
  }
  try {
    const res = await fetch(`${APPS_SCRIPT_URL}?action=sessions`);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "load failed");
    if (!data.sessions.length) {
      sessionSel.innerHTML = '<option value="">현재 모집 중인 회차가 없습니다</option>';
      $("submitBtn").disabled = true;
      return;
    }
    sessionSel.innerHTML = '<option value="">회차를 선택해 주세요</option>' +
      data.sessions.map(s =>
        `<option value="${escapeAttr(s.id)}">${escapeText(s.label)} · ${s.full ? "정원 마감(대기 접수)" : `잔여 ${s.remaining}석`}</option>`
      ).join("");
  } catch (e) {
    sessionSel.innerHTML = '<option value="">일정을 불러오지 못했습니다</option>';
    setMsg("일정을 불러오지 못했습니다. 잠시 후 새로고침해 주세요.", "err");
  }
}

function escapeText(s) {
  return String(s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}
function escapeAttr(s) {
  return escapeText(s).replace(/"/g, "&quot;");
}

// ===== 신청 제출 =====
const form = $("applyForm");
const msgEl = $("formMsg");
let submitting = false;

function setMsg(text, kind) {
  msgEl.textContent = text;
  msgEl.className = "form-msg" + (kind ? " " + kind : "");
}

form.addEventListener("submit", async e => {
  e.preventDefault();
  if (submitting) return;

  const picks = selectedPicks();
  const payload = {
    session: sessionSel.value,
    name: $("fName").value.trim(),
    phone: $("fPhone").value.trim(),
    email: $("fEmail").value.trim(),
    role: $("fRole").value,
    cafe: $("fCafe").value.trim(),
    stage: $("fStage").value,
    style: $("fStyle").value,
    memo: $("fMemo").value.trim(),
    d1: picks[0] || "",
    d2: picks[1] || "",
    consent: $("fConsent").checked,
    website: $("fWebsite").value // 허니팟 (사람은 비워둠)
  };

  // 브라우저 측 간단 검증 (서버에서 다시 검증)
  if (picks.length !== MAX_PICKS) return setMsg("위에서 디저트를 2종 선택해 주세요.", "err");
  if (!payload.session) return setMsg("회차를 선택해 주세요.", "err");
  if (!payload.name) return setMsg("이름을 입력해 주세요.", "err");
  if (payload.phone.replace(/\D/g, "").length < 9) return setMsg("연락처를 확인해 주세요.", "err");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) return setMsg("이메일 주소를 확인해 주세요.", "err");
  if (!payload.role) return setMsg("구분을 선택해 주세요.", "err");
  if (!payload.consent) return setMsg("개인정보 수집·이용에 동의해 주세요.", "err");

  submitting = true;
  $("submitBtn").disabled = true;
  setMsg("접수 중입니다…", "");

  try {
    // text/plain 으로 보내 CORS 사전 요청(preflight)을 피합니다.
    const res = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!data.ok) {
      setMsg(data.error || "접수에 실패했습니다.", "err");
      submitting = false;
      $("submitBtn").disabled = false;
      return;
    }
    const waiting = data.status === "대기";
    let msg;
    if (data.mailSent === false) {
      // 접수는 됐지만 안내 메일이 나가지 못한 경우: 거짓 안심을 주지 않고 별도 안내를 예고
      msg = `신청이 접수되었습니다. (접수번호 ${data.id}) 안내 메일 발송이 지연되고 있어요. 곧 별도로 안내드릴게요.`;
    } else if (waiting) {
      msg = `대기로 접수되었습니다. (접수번호 ${data.id}) 자리가 나면 입금 안내를 먼저 보내드려요. 접수 확인 메일을 확인해 주세요.`;
    } else {
      msg = `신청이 접수되었습니다. (접수번호 ${data.id}) 입금 안내 메일을 보내드렸어요. 입금이 확인되면 확정 메일을 따로 보내드립니다. (메일이 안 보이면 스팸함도 확인해 주세요)`;
    }
    setMsg(msg, "ok");
    form.reset();
    updatePicks();
    boxes.forEach(b => (b.checked = false));
    updatePicks();
    loadSessions();
  } catch (err) {
    // 응답을 읽지 못해도 서버에는 접수됐을 수 있으므로 재제출 전 메일함 확인을 안내
    setMsg("접수 결과를 확인하지 못했습니다. 확인 메일이 왔는지 확인하시고, 없으면 잠시 후 다시 신청해 주세요.", "err");
    submitting = false;
    $("submitBtn").disabled = false;
    return;
  }
  submitting = false;
  $("submitBtn").disabled = false;
});

loadSessions();

// ===== 원가 계산기 (예시) =====
const won = n => Math.round(n).toLocaleString("ko-KR") + "원";

function calc() {
  const price = +$("price").value || 0;
  const cost = +$("cost").value || 0;
  const pack = +$("pack").value || 0;
  const fee = (+$("fee").value || 0) / 100;
  const qty = +$("qty").value || 0;
  const waste = +$("waste").value || 0;

  const msg = $("calcMsg");
  if (price <= 0) {
    $("rRate").textContent = "–";
    $("rUnit").textContent = "–";
    $("rMonth").textContent = "–";
    msg.textContent = "판매가를 입력해 주세요.";
    return;
  }

  const unitCost = cost + pack;
  const rate = (cost / price) * 100;
  const unit = price - unitCost - price * fee;
  const monthly = (unit * qty - unitCost * waste) * OPERATING_DAYS;

  $("rRate").textContent = rate.toFixed(1) + "%";
  $("rUnit").textContent = won(unit);
  $("rMonth").textContent = won(monthly);
  $("rUnit").classList.toggle("warn", unit <= 0);
  $("rMonth").classList.toggle("warn", monthly <= 0);

  msg.textContent = "인건비, 임대료, 전기·가스비 등 고정비는 반영되지 않은 값입니다. 실제 손익은 매장 전체 구조로 따져야 합니다.";
}

["price", "cost", "pack", "fee", "qty", "waste"].forEach(id =>
  $(id).addEventListener("input", calc)
);
calc();
