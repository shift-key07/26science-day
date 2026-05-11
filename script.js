// Firebase v11 SDK 불러오기
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, collection, onSnapshot, doc, setDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// =========================================================================
// [필독] 이 부분에 반드시 아까 확인하신 파이어베이스 키값들을 다시 넣어주세요!
// =========================================================================
let firebaseConfig = {
    apiKey: "AIzaSyDXE9crFnp8--aOmgcMikdbAcWyJb3ybrU",
    authDomain: "science-day-2c70e.firebaseapp.com",
    projectId: "science-day-2c70e",
    storageBucket: "science-day-2c70e.firebasestorage.app",
    messagingSenderId: "345093306604",
    appId: "1:345093306604:web:255938adf03ca79c428dc9",
    measurementId: "G-E0JGHSKX0F"
};
let appId = "maze-collab-prod"; // DB 데이터를 구분할 고유 아이디

// (참고: 로컬/캔버스 환경 자동 대응 로직 - 수정 불필요)
if (typeof __firebase_config !== 'undefined') {
    firebaseConfig = JSON.parse(__firebase_config);
    appId = typeof __app_id !== 'undefined' ? __app_id : 'maze-collab-canvas';
}
// =========================================================================

// Firebase 초기화
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let currentUser = null;
let currentCell = -1;
const globalCellData = {}; // Firestore에서 불러온 전체 데이터 저장소
let currentStrokes = []; // 현재 열린 편집기의 선 목록

// 토스트(알림) UI 함수
function showToast(msg, isError = true) {
    const toast = document.createElement('div');
    toast.className = `px-6 py-3 rounded-xl shadow-lg text-white font-bold transition-all duration-300 transform -translate-y-10 opacity-0 ${isError ? 'bg-red-500' : 'bg-indigo-600'}`;
    toast.textContent = msg;
    document.getElementById('toastContainer').appendChild(toast);
    
    requestAnimationFrame(() => {
        toast.classList.remove('-translate-y-10', 'opacity-0');
        toast.classList.add('translate-y-0', 'opacity-100');
    });

    setTimeout(() => {
        toast.classList.remove('translate-y-0', 'opacity-100');
        toast.classList.add('-translate-y-10', 'opacity-0');
        setTimeout(() => toast.remove(), 300);
    }, 2500);
}

// 1. 초기 인증 및 실시간 동기화 리스너 등록
document.addEventListener('DOMContentLoaded', async () => {
    initGrid(); // DOM 요소 먼저 생성

    try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
            await signInWithCustomToken(auth, __initial_auth_token);
        } else {
            await signInAnonymously(auth); // 익명 로그인으로 사용자 식별
        }
    } catch (error) {
        showToast("데이터베이스 연결에 실패했습니다. 설정을 확인해주세요.");
        console.error(error);
    }

    onAuthStateChanged(auth, (user) => {
        currentUser = user;
        if (user) {
            startRealtimeSync();
        }
    });
});

// 2. Firestore 실시간 동기화 시작
function startRealtimeSync() {
    if (!currentUser) return;
    const cellsRef = collection(db, 'artifacts', appId, 'public', 'data', 'mazecells');
    
    // DB에 데이터가 변경될 때마다 자동으로 실행되는 함수
    onSnapshot(cellsRef, (snapshot) => {
        snapshot.forEach(docSnap => {
            const id = parseInt(docSnap.id);
            const data = docSnap.data();
            globalCellData[id] = data;
            
            const tCanvas = document.getElementById(`thumb-${id}`);
            const tCtx = tCanvas.getContext('2d');
            const lockOverlay = document.getElementById(`lock-overlay-${id}`);
            const editBtn = document.getElementById(`edit-btn-${id}`);
            
            // 이미지 업데이트
            if (data.imageData) {
                const img = new Image();
                img.onload = () => tCtx.drawImage(img, 0, 0, 400, 400, 0, 0, 200, 200);
                img.src = data.imageData;
            } else {
                tCtx.fillStyle = 'white';
                tCtx.fillRect(0, 0, 200, 200);
                drawMarkers(tCtx, 200, id);
            }

            // 잠금 상태 UI 업데이트 (다른 사용자가 락을 걸었을 경우)
            if (data.isLocked && data.lockedBy !== currentUser.uid) {
                lockOverlay.classList.remove('hidden');
                editBtn.classList.add('hidden');
            } else {
                lockOverlay.classList.add('hidden');
                editBtn.classList.remove('hidden');
            }
        });
    }, (error) => {
        console.error("동기화 에러:", error);
    });
}

// === 이하 그리기, 알고리즘 로직 ===
const editorModal = document.getElementById('editorModal');
const modalTitle = document.getElementById('modalTitle');
const editorCanvas = document.getElementById('editorCanvas');
const editorCtx = editorCanvas.getContext('2d', { willReadFrequently: true });
const validationMsg = document.getElementById('validationMsg');

let currentTool = 'pen';
const toolPenBtn = document.getElementById('toolPenBtn');
const toolEraserBtn = document.getElementById('toolEraserBtn');

function updateToolUI() {
    if (currentTool === 'pen') {
        toolPenBtn.className = "px-5 py-1.5 bg-indigo-600 text-white rounded-lg font-bold text-sm shadow-sm transition-colors border-2 border-indigo-600";
        toolEraserBtn.className = "px-5 py-1.5 bg-white text-gray-700 rounded-lg font-bold text-sm shadow-sm transition-colors border-2 border-gray-200 hover:bg-gray-50";
    } else {
        toolEraserBtn.className = "px-5 py-1.5 bg-indigo-600 text-white rounded-lg font-bold text-sm shadow-sm transition-colors border-2 border-indigo-600";
        toolPenBtn.className = "px-5 py-1.5 bg-white text-gray-700 rounded-lg font-bold text-sm shadow-sm transition-colors border-2 border-gray-200 hover:bg-gray-50";
    }
}

toolPenBtn.addEventListener('click', () => { currentTool = 'pen'; updateToolUI(); });
toolEraserBtn.addEventListener('click', () => { currentTool = 'eraser'; updateToolUI(); });

function getMarkers(idx) {
    let entry = 'left', exit = 'right';
    const row = Math.floor(idx / 6);
    if (row === 0) { 
        if (idx === 5) exit = 'bottom'; 
    } else if (row === 1) { 
        if (idx === 11) entry = 'top'; 
        else entry = 'right';
        if (idx === 6) exit = 'bottom'; 
        else exit = 'left';
    } else if (row === 2) { 
        if (idx === 12) entry = 'top'; 
        else entry = 'left';
        if (idx === 17) exit = 'bottom'; 
        else exit = 'right';
    } else if (row === 3) { 
        if (idx === 23) entry = 'top'; 
        else entry = 'right';
        exit = 'left'; 
    }
    return { entry, exit };
}

function drawMarkers(ctx, size, idx) {
    const markers = getMarkers(idx);
    const mSize = size * 0.05; 
    const mid = (size / 2) - (mSize / 2);

    const drawRect = (type, pos) => {
        ctx.fillStyle = type === 'entry' ? '#10B981' : '#EF4444'; 
        let x = 0, y = 0;
        if (pos === 'left') { x = 0; y = mid; }
        else if (pos === 'right') { x = size - mSize; y = mid; }
        else if (pos === 'top') { x = mid; y = 0; }
        else if (pos === 'bottom') { x = mid; y = size - mSize; }
        ctx.fillRect(x, y, mSize, mSize);
    };

    drawRect('entry', markers.entry);
    drawRect('exit', markers.exit);
}

function redrawCanvas() {
    editorCtx.fillStyle = 'white';
    editorCtx.fillRect(0, 0, 400, 400);
    editorCtx.strokeStyle = '#1F2937';
    editorCtx.lineWidth = 12;
    editorCtx.lineCap = 'round';

    for (const stroke of currentStrokes) {
        editorCtx.beginPath();
        editorCtx.moveTo(stroke.x1, stroke.y1);
        editorCtx.lineTo(stroke.x2, stroke.y2);
        editorCtx.stroke();
    }
    drawMarkers(editorCtx, 400, currentCell);
}

// 길 검증 알고리즘
function validatePathConnection() {
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = 400; tempCanvas.height = 400;
    const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
    
    tempCtx.fillStyle = 'white';
    tempCtx.fillRect(0, 0, 400, 400);
    tempCtx.strokeStyle = '#1F2937'; tempCtx.lineWidth = 12; tempCtx.lineCap = 'round';
    
    for (const stroke of currentStrokes) {
        tempCtx.beginPath();
        tempCtx.moveTo(stroke.x1, stroke.y1);
        tempCtx.lineTo(stroke.x2, stroke.y2);
        tempCtx.stroke();
    }
    
    const imgData = tempCtx.getImageData(0, 0, 400, 400).data;
    const markers = getMarkers(currentCell);
    const mSize = 20; const mid = 200 - (mSize / 2); 
    
    function getRect(pos) {
        if (pos === 'left') return {x: 0, y: mid, w: mSize, h: mSize};
        if (pos === 'right') return {x: 400 - mSize, y: mid, w: mSize, h: mSize};
        if (pos === 'top') return {x: mid, y: 0, w: mSize, h: mSize};
        if (pos === 'bottom') return {x: mid, y: 400 - mSize, w: mSize, h: mSize};
    }
    
    const entryRect = getRect(markers.entry);
    const exitRect = getRect(markers.exit);
    const queue = new Int32Array(400 * 400 * 2);
    let head = 0, tail = 0;
    const visited = new Uint8Array(400 * 400);
    
    for (let y = entryRect.y; y < entryRect.y + entryRect.h; y++) {
        for (let x = entryRect.x; x < entryRect.x + entryRect.w; x++) {
            const idx = y * 400 + x;
            if (imgData[idx * 4] > 200) { 
                visited[idx] = 1;
                queue[tail++] = x; queue[tail++] = y;
            }
        }
    }
    
    const dx = [0, 0, 1, -1]; const dy = [1, -1, 0, 0];
    while (head < tail) {
        const cx = queue[head++]; const cy = queue[head++];
        if (cx >= exitRect.x && cx <= exitRect.x + exitRect.w && cy >= exitRect.y && cy <= exitRect.y + exitRect.h) {
            return true;
        }
        for (let i = 0; i < 4; i++) {
            const nx = cx + dx[i]; const ny = cy + dy[i];
            if (nx >= 0 && nx < 400 && ny >= 0 && ny < 400) {
                const idx = ny * 400 + nx;
                if (!visited[idx]) {
                    visited[idx] = 1;
                    if (imgData[idx * 4] > 200) {
                        queue[tail++] = nx; queue[tail++] = ny;
                    }
                }
            }
        }
    }
    return false; 
}

// 대시보드 24칸 초기화 (잠금 UI 포함)
function initGrid() {
    const gridContainer = document.getElementById('gridContainer');
    for(let i = 0; i < 24; i++) {
        const cell = document.createElement('div');
        cell.className = 'bg-gray-50 border-2 border-dashed border-gray-300 relative cursor-pointer hover:border-indigo-500 hover:shadow-lg transition-all group overflow-hidden flex items-center justify-center aspect-square rounded-lg';
        cell.innerHTML = `
            <span class="absolute top-2 left-2 text-gray-400 font-black text-lg z-10 group-hover:text-indigo-500">${i + 1}</span>
            <canvas id="thumb-${i}" width="200" height="200" class="w-full h-full object-contain absolute inset-0"></canvas>
            
            <div id="edit-btn-${i}" class="opacity-0 group-hover:opacity-100 absolute inset-0 bg-indigo-500/10 flex items-center justify-center transition-opacity z-20 pointer-events-none">
                <span class="bg-indigo-600 text-white px-3 py-1 rounded-full text-sm font-bold shadow pointer-events-auto">편집</span>
            </div>

            <div id="lock-overlay-${i}" class="hidden absolute inset-0 bg-gray-900/60 flex flex-col items-center justify-center z-30 transition-opacity">
                <span class="text-3xl mb-1">🔒</span>
                <span class="text-white text-xs font-bold bg-black/60 px-2 py-1 rounded">다른 사용자가 편집 중</span>
            </div>
        `;
        cell.querySelector('.pointer-events-auto').addEventListener('click', (e) => {
            e.stopPropagation();
            openEditor(i);
        });
        cell.addEventListener('click', () => openEditor(i));
        gridContainer.appendChild(cell);

        const tCtx = document.getElementById(`thumb-${i}`).getContext('2d');
        tCtx.fillStyle = 'white'; tCtx.fillRect(0, 0, 200, 200);
        drawMarkers(tCtx, 200, i);
    }
}

// 모달 열기 (DB 잠금 처리)
async function openEditor(idx) {
    if (!currentUser) {
        showToast("서버에 연결 중입니다. 잠시만 기다려주세요.");
        return;
    }
    
    const data = globalCellData[idx];
    if (data?.isLocked && data?.lockedBy !== currentUser.uid) {
        showToast("다른 사용자가 이미 편집 중인 구역입니다.");
        return;
    }

    currentCell = idx;
    
    // Firestore에 구역 잠금 상태 기록
    try {
        const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'mazecells', idx.toString());
        await setDoc(docRef, { isLocked: true, lockedBy: currentUser.uid }, { merge: true });
    } catch (e) {
        console.error("Lock error", e);
    }

    modalTitle.textContent = `${idx + 1}번 칸 편집기`;
    validationMsg.classList.add('hidden'); 
    editorModal.classList.remove('hidden');

    currentStrokes = data?.strokes ? JSON.parse(data.strokes) : []; 
    redrawCanvas();
}

// 모달 닫기 (DB 잠금 해제)
document.getElementById('closeModalBtn').addEventListener('click', async () => {
    if (currentCell !== -1 && currentUser) {
        try {
            const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'mazecells', currentCell.toString());
            await setDoc(docRef, { isLocked: false, lockedBy: null }, { merge: true });
        } catch(e) {}
        currentCell = -1;
    }
    editorModal.classList.add('hidden');
});

// 지우개 알고리즘
function getDistanceToSegment(p, v, w) {
    const l2 = (w.x - v.x) ** 2 + (w.y - v.y) ** 2;
    if (l2 === 0) return Math.sqrt((p.x - v.x) ** 2 + (p.y - v.y) ** 2);
    let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
    t = Math.max(0, Math.min(1, t));
    const proj = { x: v.x + t * (w.x - v.x), y: v.y + t * (w.y - v.y) };
    return Math.sqrt((p.x - proj.x) ** 2 + (p.y - proj.y) ** 2);
}

function tryErase(pos) {
    let erased = false;
    for (let i = currentStrokes.length - 1; i >= 0; i--) {
        const stroke = currentStrokes[i];
        const dist = getDistanceToSegment(pos, {x: stroke.x1, y: stroke.y1}, {x: stroke.x2, y: stroke.y2});
        if (dist <= 15) { 
            currentStrokes.splice(i, 1); erased = true;
        }
    }
    if (erased) { redrawCanvas(); validationMsg.classList.add('hidden'); }
}

let isDrawing = false, startX = 0, startY = 0, currentX = 0, currentY = 0;

function getPos(e) {
    const rect = editorCanvas.getBoundingClientRect();
    let cx = e.clientX, cy = e.clientY;
    if(e.touches && e.touches.length > 0) { cx = e.touches[0].clientX; cy = e.touches[0].clientY; }
    return { x: (cx - rect.left) * (editorCanvas.width / rect.width), y: (cy - rect.top) * (editorCanvas.height / rect.height) };
}

function startDraw(e) {
    isDrawing = true; const pos = getPos(e); currentX = pos.x; currentY = pos.y;
    if (currentTool === 'eraser') tryErase(pos);
    else { startX = pos.x; startY = pos.y; validationMsg.classList.add('hidden'); }
}

function draw(e) {
    if (!isDrawing) return;
    const pos = getPos(e); currentX = pos.x; currentY = pos.y;
    if (currentTool === 'eraser') tryErase(pos);
    else {
        redrawCanvas(); 
        editorCtx.beginPath(); editorCtx.moveTo(startX, startY); editorCtx.lineTo(pos.x, pos.y);
        editorCtx.strokeStyle = '#1F2937'; editorCtx.lineWidth = 12; editorCtx.lineCap = 'round'; editorCtx.stroke();
    }
}

function stopDraw() {
    if (!isDrawing) return;
    isDrawing = false;
    if (currentTool === 'pen') {
        if (Math.abs(startX - currentX) > 1 || Math.abs(startY - currentY) > 1) {
            currentStrokes.push({ x1: startX, y1: startY, x2: currentX, y2: currentY });
        }
        redrawCanvas();
    }
}

editorCanvas.addEventListener('mousedown', startDraw);
editorCanvas.addEventListener('mousemove', draw);
editorCanvas.addEventListener('mouseup', stopDraw);
editorCanvas.addEventListener('mouseout', stopDraw);
editorCanvas.addEventListener('touchstart', (e) => { e.preventDefault(); startDraw(e); }, { passive: false });
editorCanvas.addEventListener('touchmove', (e) => { e.preventDefault(); draw(e); }, { passive: false });
editorCanvas.addEventListener('touchend', (e) => { e.preventDefault(); stopDraw(); }, { passive: false });

document.getElementById('clearCellBtn').addEventListener('click', () => {
    currentStrokes = []; validationMsg.classList.add('hidden'); redrawCanvas();
});

// 미로 저장 및 DB 업로드
document.getElementById('saveCellBtn').addEventListener('click', async () => {
    if (currentCell === -1 || !currentUser) return;
    
    if (!validatePathConnection()) {
        validationMsg.classList.remove('hidden'); 
        return; 
    }
    
    redrawCanvas(); 
    const dataUrl = editorCanvas.toDataURL('image/png');
    
    try {
        const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'mazecells', currentCell.toString());
        await setDoc(docRef, { 
            isLocked: false, 
            lockedBy: null,
            strokes: JSON.stringify(currentStrokes), // 좌표 데이터 저장
            imageData: dataUrl // 썸네일 이미지 데이터 저장
        }, { merge: true });
        
        showToast("구역이 성공적으로 저장 및 동기화되었습니다.", false);
    } catch(e) {
        showToast("저장 중 오류가 발생했습니다.");
        console.error(e);
    }

    currentCell = -1;
    editorModal.classList.add('hidden');
});

// 창을 닫거나 새로고침 할 때 Lock 풀어주기
window.addEventListener('beforeunload', () => {
    if (currentCell !== -1 && currentUser) {
        const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'mazecells', currentCell.toString());
        setDoc(docRef, { isLocked: false, lockedBy: null }, { merge: true });
    }
});

// 전체 미로 병합 및 다운로드 (경계선 옵션 포함 + 24개 개별 다운로드)
document.getElementById('downloadMergedBtn').addEventListener('click', () => {
    const offscreen = document.createElement('canvas');
    offscreen.width = 1200; offscreen.height = 800; 
    const offCtx = offscreen.getContext('2d');
    
    offCtx.fillStyle = 'white'; offCtx.fillRect(0, 0, 1200, 800);
    const includeBorders = document.getElementById('includeBorders').checked;

    if (includeBorders) { offCtx.strokeStyle = '#9CA3AF'; offCtx.lineWidth = 2; }

    for(let i = 0; i < 24; i++) {
        const tCanvas = document.getElementById(`thumb-${i}`);
        const col = i % 6; const row = Math.floor(i / 6);
        const xPos = col * 200; const yPos = row * 200;
        
        offCtx.drawImage(tCanvas, xPos, yPos);
        if (includeBorders) offCtx.strokeRect(xPos, yPos, 200, 200);
    }

    // 1. 전체 병합 이미지 먼저 다운로드
    const link = document.createElement('a');
    link.download = 'snake_maze_multiplayer_1200x800.png';
    link.href = offscreen.toDataURL('image/png');
    link.click();

    // 토스트 메시지로 다중 다운로드 안내
    showToast("전체 이미지와 24개의 개별 이미지 다운로드를 시작합니다. (상단의 '여러 파일 다운로드' 팝업을 허용해주세요!)", false);

    // 2. 24개의 개별 칸 이미지를 0.2초 간격으로 순차적 다운로드
    for(let i = 0; i < 24; i++) {
        setTimeout(() => {
            const tCanvas = document.getElementById(`thumb-${i}`);
            const singleLink = document.createElement('a');
            
            // 개별 다운로드 이미지에도 경계선 설정 상태를 똑같이 반영하기 위해 임시 캔버스 사용
            const singleOffscreen = document.createElement('canvas');
            singleOffscreen.width = 200; singleOffscreen.height = 200;
            const singleCtx = singleOffscreen.getContext('2d');
            singleCtx.drawImage(tCanvas, 0, 0);
            
            if (includeBorders) {
                singleCtx.strokeStyle = '#9CA3AF'; 
                singleCtx.lineWidth = 2;
                singleCtx.strokeRect(0, 0, 200, 200);
            }

            // 파일 이름: maze_cell_01.png ~ maze_cell_24.png
            const cellNumber = String(i + 1).padStart(2, '0');
            singleLink.download = `maze_cell_${cellNumber}.png`; 
            singleLink.href = singleOffscreen.toDataURL('image/png');
            singleLink.click();
            
        }, (i + 1) * 200); // i번째 파일마다 200ms(0.2초)씩 딜레이 추가
    }
});
