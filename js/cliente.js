// js/cliente.js - Portal del Cliente

import {
  doc,
  getDoc,
  getDocs,
  collection,
  addDoc,
  query,
  where,
  deleteDoc,
  orderBy,
  limit,
  serverTimestamp
} from "firebase/firestore";
import { db } from "./firebase-config.js";
import Swal from "sweetalert2";
import html2canvas from "html2canvas";

// Configuración global de alertas con SweetAlert2
window.alert = function (mensaje) {
  Swal.fire({
    text: mensaje,
    confirmButtonColor: '#16a34a',
    confirmButtonText: 'Entendido'
  });
};

let clienteActual = null;
let turnoSeleccionado = null;
let horaLimiteGlobal = "19:00";

// Funciones Helper de limpieza
function normalizarFecha(f) {
  if (!f) return '';
  const partes = f.split('/');
  if (partes.length === 3) {
    return `${partes[2]}-${partes[1].padStart(2, '0')}-${partes[0].padStart(2, '0')}`;
  }
  return f;
}

// 🟢 NUEVO HELPER: Evita errores por mayúsculas o espacios en nombres de zonas
function claveZona(nombreZona) {
  return String(nombreZona || 'General').trim().toLowerCase();
}

// ==========================================================
// 1. LÓGICA DE HORA LÍMITE GLOBAL Y VALIDACIÓN
// ==========================================================
async function obtenerHoraLimiteGlobal() {
  try {
    const docConfigRef = doc(db, "configuracion", "agenda");
    const snap = await getDoc(docConfigRef);
    if (snap.exists() && snap.data().horaCierre) {
      horaLimiteGlobal = snap.data().horaCierre;
    }
  } catch (error) {
    console.error("Error al consultar hora límite global:", error);
  }
  return horaLimiteGlobal;
}

async function actualizarBannerHoraCliente() {
  const lblHora = document.getElementById("lblHoraCierreCliente");
  if (!lblHora) return;

  const horaCierre = await obtenerHoraLimiteGlobal();
  lblHora.textContent = horaCierre;
}

function esTurnoValido(fechaStr) {
  if (!fechaStr) return false;

  let dia, mes, anio;
  if (fechaStr.includes('/')) {
    const partes = fechaStr.split('/');
    if (partes.length !== 3) return false;
    dia = parseInt(partes[0], 10);
    mes = parseInt(partes[1], 10) - 1;
    anio = parseInt(partes[2], 10);
  } else if (fechaStr.includes('-')) {
    const partes = fechaStr.split('-');
    if (partes.length !== 3) return false;
    anio = parseInt(partes[0], 10);
    mes = parseInt(partes[1], 10) - 1;
    dia = parseInt(partes[2], 10);
  } else {
    return false;
  }

  const [hCierre, mCierre] = horaLimiteGlobal.split(':').map(Number);
  const fechaCorte = new Date(anio, mes, dia - 1, hCierre || 19, mCierre || 0, 0);
  const ahora = new Date();

  return ahora < fechaCorte;
}

// ==========================================================
// 2. VERIFICAR SESIÓN Y CARGAR DATOS DEL CLIENTE
// ==========================================================
async function inicializarPortal() {
  const celuGuardado = localStorage.getItem("usuarioCelu");

  if (!celuGuardado) {
    alert("Por favor, ingresá desde la página principal con tu celular.");
    window.location.href = "/index.html";
    return;
  }

  try {
    const contenedor = document.getElementById("contenedorDiasDisponibles");
    if (contenedor) {
      contenedor.innerHTML = '<p class="texto-carga texto-carga--centro">Cargando turnos disponibles...</p>';
    }

    const docRef = doc(db, "usuarios", celuGuardado);
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
      clienteActual = { id: docSnap.id, ...docSnap.data() };
      renderizarDatosCliente(clienteActual);
      cargarInfoEconomicaCliente(clienteActual);

      await actualizarBannerHoraCliente();
      cargarTurnosDisponiblesCliente(clienteActual.zona);
      cargarMisSolicitudes(clienteActual.id);
      configurarSelectorEntrega();
      configurarContadorBaldes();
      configurarBotonPedirBalde();
      configurarBotonCompartir();
    } else {
      alert("Usuario no encontrado.");
      window.location.href = "/index.html";
    }
  } catch (error) {
    console.error("Error al cargar portal:", error);
  }
}

function renderizarDatosCliente(c) {
  const elNombre = document.getElementById("clienteNombre");
  if (elNombre) elNombre.innerHTML = `<i class="ri-user-3-line icon"></i> ¡Hola, ${c.nombre || "Cliente"}!`;

  const elZona = document.getElementById("clienteZona");
  if (elZona) elZona.innerText = c.zona || "General";

  const elDireccion = document.getElementById("clienteDireccion");
  if (elDireccion) elDireccion.innerText = c.direccion || "Sin especificar";

  const elFechaInicio = document.getElementById("clienteFechaInicio");
  if (elFechaInicio && c.fechaInicioServicio) {
    const partes = c.fechaInicioServicio.split('-');
    if (partes.length === 3) {
      elFechaInicio.innerText = `Miembro desde: ${partes[2]}/${partes[1]}/${partes[0]}`;
    } else {
      elFechaInicio.innerText = `Miembro desde: ${c.fechaInicioServicio}`;
    }
  }

  let diasCompostando = 0;
  if (c.fechaInicioServicio) {
    const fechaIni = new Date(c.fechaInicioServicio + "T00:00:00");
    const hoy = new Date();
    diasCompostando = Math.max(0, Math.floor((hoy - fechaIni) / (1000 * 60 * 60 * 24)));
  }

  const elDias = document.getElementById("clienteDiasCompostando");
  if (elDias) elDias.innerText = diasCompostando;

  const baldes = c.baldesCompostados ?? c.totalBaldes ?? 0;
  const elBaldes = document.getElementById("clienteBaldesTotal");
  if (elBaldes) elBaldes.innerText = baldes;

  const totalKg = Number(c.totalKilos || 0);
  const elKilos = document.getElementById("clienteKilos");
  if (elKilos) elKilos.innerText = `${totalKg.toFixed(1)} kg`;

  const compostProducido = (totalKg / 3).toFixed(1);
  const elCompost = document.getElementById("clienteCompostProducido");
  if (elCompost) elCompost.innerText = `${compostProducido} kg`;

  const cajaPago = document.getElementById("cajaEstadoCuenta");
  if (cajaPago) cajaPago.innerHTML = '<p class="texto-suave estado-cuenta-cargando">Cargando estado de cuenta...</p>';
}

function formatearMoneda(valor) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0
  }).format(Number(valor || 0));
}

function formatearFechaRecoleccion(timestamp) {
  if (!timestamp || typeof timestamp.toDate !== 'function') return 'Sin fecha';
  return timestamp.toDate().toLocaleDateString('es-AR');
}

async function cargarInfoEconomicaCliente(cliente) {
  const precioEl = document.getElementById('clientePrecioBalde');
  const cajaPago = document.getElementById('cajaEstadoCuenta');

  try {
    const zonasSnap = await getDocs(collection(db, 'zonas'));
    const mapaZonas = new Map();
    
    // 🟢 CREAMOS UN MAPA LIMPIO DE ZONAS PARA EVITAR FALLOS
    zonasSnap.forEach(docSnap => {
      const z = docSnap.data();
      mapaZonas.set(claveZona(z.nombre), Number(z.precioBalde || 0));
    });

    // 🟢 BUSCAMOS EL PRECIO USANDO LA CLAVE LIMPIA
    const precioActual = mapaZonas.get(claveZona(cliente.zona)) || 0;

    if (precioEl) {
      precioEl.textContent = precioActual > 0 ? formatearMoneda(precioActual) : 'Sin configurar';
    }

    if (!cajaPago) return;

    const qRecolecciones = query(collection(db, 'recolecciones'), where('clienteId', '==', cliente.id));
    const recoleccionesSnap = await getDocs(qRecolecciones);
    const pendientes = [];

    recoleccionesSnap.forEach(docSnap => {
      const r = { id: docSnap.id, ...docSnap.data() };
      if ((r.estadoPago || '').toLowerCase() === 'pendiente') pendientes.push(r);
    });

    pendientes.sort((a, b) => (b.fechaRetiro?.seconds || 0) - (a.fechaRetiro?.seconds || 0));
    const saldo = Number(cliente.saldoPendiente || 0);

    if (saldo > 0 || pendientes.length > 0) {
      let detalle = '';
      if (pendientes.length > 0) {
        detalle = `
          <div class="detalle-deuda-cliente">
            <strong class="titulo-deudas-cliente">Recolecciones pendientes</strong>
            ${pendientes.map(r => `
              <div class="item-deuda-cliente">
                <span>${formatearFechaRecoleccion(r.fechaRetiro)} · ${Number(r.cantidadBaldes || 0)} balde${Number(r.cantidadBaldes || 0) === 1 ? '' : 's'}</span>
                <strong>${formatearMoneda(r.total || 0)}</strong>
              </div>
            `).join('')}
          </div>
        `;
      }

      cajaPago.innerHTML = `
        <p class="estado-pendiente-cliente"><i class="ri-error-warning-line icon"></i> Saldo pendiente: ${formatearMoneda(saldo)}</p>
        <p class="estado-cuenta-subtexto">Valor actual en tu zona: <strong>${precioActual > 0 ? formatearMoneda(precioActual) + ' por balde' : 'sin configurar'}</strong></p>
        ${detalle}
        <button onclick="window.open('https://link.mercadopago.com.ar/tu-alias-aqui', '_blank')" class="btn-login-confirmar"><i class="ri-bank-card-line icon"></i> Pagar con Mercado Pago</button>
      `;
    } else {
      cajaPago.innerHTML = `
        <p class="estado-ok-cliente"><i class="ri-checkbox-circle-line icon"></i> Estado de cuenta: Al día</p>
        <p class="estado-cuenta-subtexto estado-cuenta-subtexto--compacto">Valor actual por balde en tu zona: <strong>${precioActual > 0 ? formatearMoneda(precioActual) : 'Sin configurar'}</strong>.</p>
      `;
    }
  } catch (error) {
    console.error('Error al cargar precio y estado de cuenta:', error);
    if (precioEl) precioEl.textContent = 'No disponible';
    if (cajaPago) cajaPago.innerHTML = '<p class="estado-cuenta-error">No se pudo cargar el estado de cuenta.</p>';
  }
}

// ==========================================================
// 3. COMPARTIR IMPACTO ECOLÓGICO (HISTORIAS / SOCIAL)
// ==========================================================
function configurarBotonCompartir() {
  const btnCompartir = document.getElementById('btnCompartirImpacto');
  if (!btnCompartir) return;

  btnCompartir.addEventListener('click', async () => {
    const storyElem = document.getElementById('plantillaStoryInstagram');
    if (!storyElem || !clienteActual) return;

    const primerNombre = (clienteActual.nombre || "Vecino/a").trim().split(" ")[0];

    let diasCompostando = 0;
    if (clienteActual.fechaInicioServicio) {
      const fechaIni = new Date(clienteActual.fechaInicioServicio + "T00:00:00");
      const hoy = new Date();
      diasCompostando = Math.max(0, Math.floor((hoy - fechaIni) / (1000 * 60 * 60 * 24)));
    }

    const baldes = clienteActual.baldesCompostados ?? clienteActual.totalBaldes ?? 0;
    const kilos = Number(clienteActual.totalKilos || 0);
    const compost = (kilos / 3).toFixed(1);

    document.getElementById('storyNombreCliente').innerText = primerNombre;
    document.getElementById('storyDias').innerText = `${diasCompostando} días`;
    document.getElementById('storyBaldes').innerText = `${baldes} baldes`;
    document.getElementById('storyKilos').innerText = `${kilos.toFixed(1)} kg de orgánicos`;
    document.getElementById('storyCompost').innerText = `${compost} kg de compost`;

    try {
      btnCompartir.disabled = true;
      btnCompartir.innerHTML = '<i class="ri-loader-4-line icon-spin"></i> Generando Story...';

      const canvas = await html2canvas(storyElem, {
        scale: 1, useCORS: true, allowTaint: true, logging: false, windowWidth: 1080, windowHeight: 1920
      });

      canvas.toBlob(async (blob) => {
        btnCompartir.disabled = false;
        btnCompartir.innerHTML = '<i class="ri-instagram-line"></i> Compartir en Historias';
        if (!blob) return;
        const file = new File([blob], 'mi-impacto-compost.png', { type: 'image/png' });

        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: 'Mi Impacto en Zona de Compost' });
        } else {
          const enlace = document.createElement('a');
          enlace.download = 'mi-impacto-compost.png';
          enlace.href = canvas.toDataURL('image/png');
          enlace.click();
          Swal.fire({
            icon: 'success', title: '¡Story lista para publicar! 📸',
            text: 'Descargamos la imagen con el tamaño exacto para tus historias.', confirmButtonColor: '#16a34a'
          });
        }
      }, 'image/png');
    } catch (error) {
      btnCompartir.disabled = false;
      btnCompartir.innerHTML = '<i class="ri-instagram-line"></i> Compartir en Historias';
      console.error('Error al generar la historia:', error);
    }
  });
}

// ==========================================================
// 4. CONFIGURACIÓN DEL CONTADOR TÁCTIL (+ / -)
// ==========================================================
function configurarContadorBaldes() {
  const inputBaldes = document.getElementById('cantBaldesCliente');
  const btnRestar = document.getElementById('btnRestarBaldes');
  const btnSumar = document.getElementById('btnSumarBaldes');

  if (btnRestar && btnSumar && inputBaldes) {
    btnRestar.onclick = () => { let valorActual = parseInt(inputBaldes.value) || 1; if (valorActual > 1) inputBaldes.value = valorActual - 1; };
    btnSumar.onclick = () => { let valorActual = parseInt(inputBaldes.value) || 1; if (valorActual < 10) inputBaldes.value = valorActual + 1; };
  }
}

// ==========================================================
// 5. DETECCIÓN DINÁMICA DE SELECCIÓN DE ENTREGA
// ==========================================================
function configurarSelectorEntrega() {
  const selectEntrega = document.getElementById("selectEntregaCliente");
  if (selectEntrega) {
    selectEntrega.addEventListener("change", (e) => {
      const cajaOtro = document.getElementById("cajaNotaOtro");
      if (cajaOtro) {
        if (e.target.value === "Otro") {
          cajaOtro.style.display = "block";
        } else {
          cajaOtro.style.display = "none";
          const inputNota = document.getElementById("notaBaldeCliente");
          if (inputNota) inputNota.value = "";
        }
      }
    });
  }
}

// ==========================================================
// 6. CARGAR TURNOS OPTIMIZADOS POR ZONA (CONSULTA DIRECTA FIRESTORE)
// ==========================================================
async function cargarTurnosDisponiblesCliente(zonaUsuario) {
  const contenedor = document.getElementById('contenedorDiasDisponibles');
  if (!contenedor) return;

  try {
    await obtenerHoraLimiteGlobal();
    const lblHora = document.getElementById("lblHoraCierreCliente");
    if (lblHora) lblHora.textContent = horaLimiteGlobal;

    const zonasPermitidas = Array.from(new Set([zonaUsuario || 'General', 'General']));
    const q = query(collection(db, "disponibilidad"), where("zona", "in", zonasPermitidas));
    const querySnapshot = await getDocs(q);

    if (querySnapshot.empty) {
      contenedor.innerHTML = '<p class="texto-suave">No hay horarios disponibles por el momento.</p>';
      return;
    }

    const diasMap = {};
    querySnapshot.forEach((docSnap) => {
      const data = docSnap.data();
      const fecha = data.dia || data.fecha;
      const horario = data.horario || data.hora;
      if (!esTurnoValido(fecha)) return;

      if (fecha && horario) {
        if (!diasMap[fecha]) diasMap[fecha] = [];
        diasMap[fecha].push({ id: docSnap.id, horario: horario, dia: fecha });
      }
    });

    const listaDias = Object.keys(diasMap);
    if (listaDias.length === 0) {
      contenedor.innerHTML = `<p class="texto-suave">No hay turnos disponibles actualmente para la zona <strong>${zonaUsuario || 'General'}</strong>.</p>`;
      return;
    }

    listaDias.sort((a, b) => normalizarFecha(a).localeCompare(normalizarFecha(b)));
    contenedor.innerHTML = "";

    listaDias.forEach((fecha) => {
      diasMap[fecha].sort((a, b) => a.horario.localeCompare(b.horario));
      const tarjetaDia = document.createElement('div');
      tarjetaDia.className = 'tarjeta-dia-disponible';
      let htmlFranjas = `<strong class="titulo-dia-disponible">📅 ${fecha}</strong><div class="contenedor-franjas-horarias">`;
      diasMap[fecha].forEach((item) => {
        htmlFranjas += `<button type="button" class="btn-horario-item" onclick="seleccionarTurnoCliente('${fecha}', '${item.horario}', '${item.id}', this)">🕒 ${item.horario}</button>`;
      });
      htmlFranjas += `</div>`;
      tarjetaDia.innerHTML = htmlFranjas;
      contenedor.appendChild(tarjetaDia);
    });

  } catch (error) {
    console.error("Error al cargar turnos disponibles:", error);
    contenedor.innerHTML = '<p class="mensaje-error-cliente texto-carga">Error al cargar los turnos disponibles.</p>';
  }
}

window.seleccionarTurnoCliente = function (fecha, horario, docId, elementoBtn) {
  document.querySelectorAll('.btn-horario-item').forEach(btn => btn.classList.remove('seleccionado'));
  elementoBtn.classList.add('seleccionado');
  turnoSeleccionado = { id: docId, dia: fecha, horario: horario };
  const inputFecha = document.getElementById('fechaSeleccionadaFinal');
  const inputHorario = document.getElementById('horarioSeleccionadoFinal');
  if (inputFecha) inputFecha.value = fecha;
  if (inputHorario) inputHorario.value = horario;
};

// ==========================================================
// 7. CONFIRMAR SOLICITUD DE RETIRO
// ==========================================================
function configurarBotonPedirBalde() {
  const btn = document.getElementById("btnPedirBaldeCliente");
  if (!btn) return;

  btn.onclick = async () => {
    const inputFecha = document.getElementById("fechaSeleccionadaFinal");
    const inputHorario = document.getElementById("horarioSeleccionadoFinal");
    const selectEntrega = document.getElementById("selectEntregaCliente");
    const inputNota = document.getElementById("notaBaldeCliente");
    const inputBaldes = document.getElementById("cantBaldesCliente");

    const cantBaldes = parseInt(inputBaldes?.value) || 1;
    const dia = inputFecha ? inputFecha.value : "";
    const horario = inputHorario ? inputHorario.value : "";
    const modoEntrega = selectEntrega ? selectEntrega.value : "";
    const notaOtro = inputNota ? inputNota.value.trim() : "";

    if (!dia || !horario) { alert("Por favor, seleccioná un horario disponible."); return; }
    if (!esTurnoValido(dia)) {
      Swal.fire({ icon: 'warning', title: 'Reserva cerrada', text: `El tiempo límite para reservar finalizó ayer a las ${horaLimiteGlobal} hs.`, confirmButtonColor: '#dc2626' });
      cargarTurnosDisponiblesCliente(clienteActual.zona); return;
    }
    if (!modoEntrega) { alert("Por favor, seleccioná la modalidad de entrega."); return; }

    let notaFinal = modoEntrega;
    if (modoEntrega === "Otro") {
      if (!notaOtro) { alert("Por favor, especificá el detalle de la entrega."); return; }
      notaFinal = `Otro: ${notaOtro}`;
    }

    try {
      btn.disabled = true; btn.innerText = "Enviando solicitud...";
      await addDoc(collection(db, "pedidos_retiro"), {
        clienteId: clienteActual.id, nombre: clienteActual.nombre || "Sin nombre", clienteNombre: clienteActual.nombre || "Sin nombre",
        clienteCelu: clienteActual.id, zona: clienteActual.zona || "General", clienteZona: clienteActual.zona || "General",
        direccion: clienteActual.direccion || "-", clienteDireccion: clienteActual.direccion || "-",
        turnoElegido: `${dia} - ${horario}`, nota: notaFinal, cantBaldes: cantBaldes, estado: "Pendiente", fechaSolicitud: serverTimestamp()
      });

      if (turnoSeleccionado && turnoSeleccionado.id) { await deleteDoc(doc(db, "disponibilidad", turnoSeleccionado.id)); turnoSeleccionado = null; }
      Swal.fire({ icon: 'success', title: '¡Solicitud enviada!', text: 'Recibimos tu pedido de retiro correctamente.', confirmButtonColor: '#16a34a', confirmButtonText: 'Genial' });

      if (inputFecha) inputFecha.value = ""; if (inputHorario) inputHorario.value = "";
      if (selectEntrega) selectEntrega.value = ""; if (inputNota) inputNota.value = ""; if (inputBaldes) inputBaldes.value = 1;

      cargarTurnosDisponiblesCliente(clienteActual.zona); cargarMisSolicitudes(clienteActual.id);
    } catch (error) {
      console.error("Error al solicitar retiro:", error); alert("Ocurrió un error al enviar la solicitud.");
    } finally {
      btn.disabled = false; btn.innerHTML = '<i class="ri-send-plane-fill icon"></i> Confirmar Solicitud de Retiro';
    }
  };
}

// ==========================================================
// 8. HISTORIAL DE RETIROS (ÚLTIMAS 3 SOLICITUDES)
// ==========================================================
async function cargarMisSolicitudes(clienteId) {
  const contenedor = document.getElementById("listaMisSolicitudes");
  if (!contenedor) return;

  try {
    const q = query(collection(db, "pedidos_retiro"), where("clienteId", "==", clienteId), orderBy("fechaSolicitud", "desc"), limit(3));
    const querySnapshot = await getDocs(q);

    if (querySnapshot.empty) { contenedor.innerHTML = '<p class="texto-suave">No hiciste solicitudes todavía.</p>'; return; }

    contenedor.innerHTML = "";
    querySnapshot.forEach((docSnap) => {
      const p = docSnap.data();
      const baldesTexto = p.cantBaldes ? ` (${p.cantBaldes} 🪣)` : '';
      contenedor.innerHTML += `
        <div class="item-solicitud-historial">
          <i class="ri-calendar-event-line icon"></i> <strong>Turno:</strong> ${p.turnoElegido}${baldesTexto}<br>
          <i class="ri-map-pin-line icon"></i> <strong>Entrega:</strong> ${p.nota}<br>
          <i class="ri-time-line icon"></i> <strong>Estado:</strong> <span class="estado-solicitud-resaltado">${p.estado || "Pendiente"}</span>
        </div>`;
    });
  } catch (error) {
    console.error("Error al cargar historial con índice, usando fallback:", error);
    cargarMisSolicitudesFallback(clienteId);
  }
}

async function cargarMisSolicitudesFallback(clienteId) {
  const contenedor = document.getElementById("listaMisSolicitudes");
  if (!contenedor) return;

  try {
    const q = query(collection(db, "pedidos_retiro"), where("clienteId", "==", clienteId));
    const querySnapshot = await getDocs(q);

    if (querySnapshot.empty) { contenedor.innerHTML = '<p class="texto-suave">No hiciste solicitudes todavía.</p>'; return; }

    let solicitudes = [];
    querySnapshot.forEach((docSnap) => { solicitudes.push({ id: docSnap.id, ...docSnap.data() }); });
    solicitudes.sort((a, b) => (b.fechaSolicitud?.seconds || 0) - (a.fechaSolicitud?.seconds || 0));
    solicitudes = solicitudes.slice(0, 3);

    contenedor.innerHTML = "";
    solicitudes.forEach((p) => {
      const baldesTexto = p.cantBaldes ? ` (${p.cantBaldes} 🪣)` : '';
      contenedor.innerHTML += `
        <div class="item-solicitud-historial">
          <i class="ri-calendar-event-line icon"></i> <strong>Turno:</strong> ${p.turnoElegido}${baldesTexto}<br>
          <i class="ri-map-pin-line icon"></i> <strong>Entrega:</strong> ${p.nota}<br>
          <i class="ri-time-line icon"></i> <strong>Estado:</strong> <span class="estado-solicitud-resaltado">${p.estado || "Pendiente"}</span>
        </div>`;
    });
  } catch (err) { console.error("Error en fallback de historial:", err); }
}

// ==========================================================
// 9. CERRAR SESIÓN
// ==========================================================
window.cerrarSesion = function () {
  localStorage.removeItem("usuarioCelu");
  window.location.href = "/index.html";
};

// ==========================================================
// INICIALIZACIÓN DE PÁGINA
// ==========================================================
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => { inicializarPortal(); });
} else {
  inicializarPortal();
}