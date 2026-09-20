import {
  doc, getDoc, getDocs, setDoc, collection, addDoc, updateDoc, deleteDoc, serverTimestamp,
  query, where, limit, increment, runTransaction
} from "firebase/firestore";
import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "firebase/auth";
import Swal from "sweetalert2";

// Configuración global de alertas con SweetAlert2
window.alert = function (mensaje) {
  Swal.fire({
    text: mensaje,
    confirmButtonColor: '#16a34a',
    confirmButtonText: 'Entendido'
  });
};

// Referencia al documento global de configuración de la agenda
const docConfigRef = doc(db, "configuracion", "agenda");

// ==========================================================
// CONTROL DE ACCESO Y SESIÓN ADMIN (FIREBASE AUTH)
// ==========================================================
onAuthStateChanged(auth, (user) => {
  if (!user) {
    Swal.fire({
      icon: "warning",
      title: "Acceso denegado",
      text: "Debes iniciar sesión formalmente como Administrador.",
      confirmButtonColor: "#16a34a"
    }).then(() => {
      window.location.href = "/index.html";
    });
  } else {
    // Si la sesión es válida, carga todos los módulos del panel
    inicializarPanelAdmin();
  }
});

window.cerrarSesionAdmin = async function () {
  try {
    await signOut(auth);
    window.location.href = "/index.html";
  } catch (error) {
    console.error("Error al cerrar sesión:", error);
    window.location.href = "/index.html";
  }
};

// Variables globales para cachear datos de uso frecuente
let ultimosClientes = [];
let datosEstadoCuentas = [];
let filtroEstadoCuentas = 'todos';

// Función para convertir texto a Formato Título ("juan perez" -> "Juan Perez")
function capitalizarTexto(texto) {
  if (!texto) return "";
  return texto
    .toLowerCase()
    .trim()
    .split(' ')
    .filter(palabra => palabra.length > 0)
    .map(palabra => palabra.charAt(0).toUpperCase() + palabra.slice(1))
    .join(' ');
}

// Helper para formatear fechas de YYYY-MM-DD a DD/MM/YYYY
function formatearFechaVista(fechaIso) {
  if (!fechaIso) return "Sin registrar";
  const partes = fechaIso.split('-');
  if (partes.length === 3) {
    return `${partes[2]}/${partes[1]}/${partes[0]}`;
  }
  return fechaIso;
}

// Helper para ordenar fechas en comparaciones
function normalizarFechaTurno(f) {
  if (!f) return '';
  const partes = f.split('/');
  if (partes.length === 3) {
    return `${partes[2]}-${partes[1].padStart(2, '0')}-${partes[0].padStart(2, '0')}`;
  }
  return f;
}

// ==========================================================
// 1. CONFIGURACIÓN DE HORA LÍMITE (AGENDA)
// ==========================================================
async function cargarConfiguracionHorarioAdmin() {
  const inputHora = document.getElementById("horaLimiteAdmin");
  if (!inputHora) return;

  try {
    const snap = await getDoc(docConfigRef);
    if (snap.exists() && snap.data().horaCierre) {
      inputHora.value = snap.data().horaCierre;
    }
  } catch (error) {
    console.error("Error al cargar la hora de cierre:", error);
  }
}

document.getElementById("btnGuardarHoraLimite")?.addEventListener("click", async () => {
  const inputHora = document.getElementById("horaLimiteAdmin");
  const horaSeleccionada = inputHora ? inputHora.value : "";

  if (!horaSeleccionada) {
    Swal.fire("Atención", "Por favor seleccioná un horario válido.", "warning");
    return;
  }

  try {
    await setDoc(docConfigRef, { horaCierre: horaSeleccionada }, { merge: true });

    Swal.fire({
      icon: 'success',
      title: '¡Horario Guardado!',
      text: `El nuevo límite global de reserva es a las ${horaSeleccionada} hs del día anterior.`,
      confirmButtonColor: '#16a34a'
    });
  } catch (error) {
    console.error("Error al guardar hora de cierre:", error);
    Swal.fire("Error", "No se pudo guardar la configuración.", "error");
  }
});

// ==========================================================
// GESTIÓN Y LÓGICA DE ZONAS + PRECIO POR BALDE
// ==========================================================
function formatearMoneda(valor) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0
  }).format(Number(valor || 0));
}

function formatearFechaTimestamp(timestamp) {
  if (!timestamp || typeof timestamp.toDate !== 'function') return 'Sin fecha';
  return timestamp.toDate().toLocaleDateString('es-AR');
}

function claveZona(nombreZona) {
  return String(nombreZona || 'General').trim().toLowerCase();
}

function escaparCSV(valor) {
  return String(valor ?? '').replace(/"/g, '""');
}

function descargarArchivoCSV(contenido, nombreArchivo) {
  const blob = new Blob([contenido], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement('a');
  enlace.setAttribute('href', url);
  enlace.setAttribute('download', nombreArchivo);
  document.body.appendChild(enlace);
  enlace.click();
  document.body.removeChild(enlace);
  URL.revokeObjectURL(url);
}

async function obtenerMapaPreciosZonas() {
  const snap = await getDocs(collection(db, 'zonas'));
  const mapa = new Map();
  snap.forEach(docSnap => {
    const zona = docSnap.data();
    mapa.set(claveZona(zona.nombre), Number(zona.precioBalde || 0));
  });
  return mapa;
}

async function obtenerZonaPorNombre(nombreZona) {
  if (!nombreZona) return null;

  const qZona = query(
    collection(db, 'zonas'),
    where('nombre', '==', nombreZona),
    limit(1)
  );
  const snap = await getDocs(qZona);
  if (snap.empty) return null;

  const zonaDoc = snap.docs[0];
  return { id: zonaDoc.id, ...zonaDoc.data() };
}

async function renderizarListaZonas() {
  const contenedorLista = document.getElementById("listaZonasAdmin");
  if (!contenedorLista) return;

  contenedorLista.innerHTML = '<p class="texto-suave">Cargando zonas...</p>';

  try {
    const querySnapshot = await getDocs(collection(db, "zonas"));

    if (querySnapshot.empty) {
      contenedorLista.innerHTML = '<p class="texto-suave">No hay zonas registradas.</p>';
      return;
    }

    contenedorLista.innerHTML = "";

    querySnapshot.forEach((docSnap) => {
      const idZona = docSnap.id;
      const dataZona = docSnap.data();
      const precio = Number(dataZona.precioBalde || 0);

      const itemZona = document.createElement("div");
      itemZona.className = "tarjeta-item-zona";

      itemZona.innerHTML = `
        <div class="datos-zona-item">
          <span class="nombre-zona-item">📍 ${dataZona.nombre}</span>
          <span class="precio-zona-item">🪣 ${precio > 0 ? formatearMoneda(precio) + ' por balde' : 'Precio sin configurar'}</span>
        </div>
        <div class="acciones-zona-item">
          <button type="button" onclick="editarZonaAdmin('${idZona}')" class="btn-app btn-zona-editar">
            <i class="ri-edit-line"></i> Editar
          </button>
          <button type="button" onclick="eliminarZonaAdmin('${idZona}')" class="btn-app btn-zona-eliminar">
            <i class="ri-delete-bin-line"></i> Eliminar
          </button>
        </div>
      `;

      contenedorLista.appendChild(itemZona);
    });

  } catch (e) {
    console.error("Error al renderizar zonas: ", e);
    contenedorLista.innerHTML = '<p class="texto-suave">Error al cargar zonas.</p>';
  }
}

window.editarZonaAdmin = async function (idZona) {
  try {
    const zonaRef = doc(db, 'zonas', idZona);
    const zonaSnap = await getDoc(zonaRef);
    if (!zonaSnap.exists()) {
      Swal.fire('Atención', 'La zona ya no existe.', 'warning');
      return;
    }

    const zonaActual = zonaSnap.data();
    const resultado = await Swal.fire({
      title: 'Editar zona y precio',
      html: `
        <label for="swalNombreZona" class="swal-zona-label">Nombre de la zona</label>
        <input id="swalNombreZona" class="swal2-input swal-zona-control" value="${String(zonaActual.nombre || '').replace(/"/g, '&quot;')}">
        <label for="swalPrecioZona" class="swal-zona-label swal-zona-label--precio">Precio por balde ($)</label>
        <input id="swalPrecioZona" type="number" min="1" step="1" class="swal2-input swal-zona-control" value="${Number(zonaActual.precioBalde || 0) || ''}" placeholder="Ej: 8000">
      `,
      showCancelButton: true,
      confirmButtonText: 'Guardar cambios',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#16a34a',
      preConfirm: () => {
        const nombre = document.getElementById('swalNombreZona')?.value.trim();
        const precio = Number(document.getElementById('swalPrecioZona')?.value);
        if (!nombre) {
          Swal.showValidationMessage('Ingresá un nombre para la zona.');
          return false;
        }
        if (!Number.isFinite(precio) || precio <= 0) {
          Swal.showValidationMessage('Ingresá un precio por balde mayor a 0.');
          return false;
        }
        return { nombre, precio };
      }
    });

    if (!resultado.isConfirmed) return;

    await updateDoc(zonaRef, {
      nombre: resultado.value.nombre,
      precioBalde: resultado.value.precio,
      actualizadoEn: serverTimestamp()
    });

    Swal.fire({ text: "Zona y precio actualizados con éxito", icon: "success", confirmButtonColor: "#16a34a" });
    renderizarListaZonas();
    cargarSelectsDeZonas();
    renderizarListaCompletaClientes();
    cargarEstadoCuentas();
    cargarPedidosAdmin();
  } catch (e) {
    console.error("Error editando zona: ", e);
    Swal.fire('Error', 'No se pudo editar la zona.', 'error');
  }
};

window.eliminarZonaAdmin = async function (idZona) {
  try {
    const zonaRef = doc(db, 'zonas', idZona);
    const zonaSnap = await getDoc(zonaRef);
    if (!zonaSnap.exists()) return;
    const nombreZona = zonaSnap.data().nombre || 'esta zona';

    const confirmacion = await Swal.fire({
      title: `¿Eliminar "${nombreZona}"?`,
      text: "Esta acción no afectará a clientes ya registrados, pero esa zona dejará de estar disponible para nuevas selecciones.",
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#ef4444',
      cancelButtonColor: '#64748b',
      confirmButtonText: 'Sí, eliminar',
      cancelButtonText: 'Cancelar'
    });

    if (!confirmacion.isConfirmed) return;

    await deleteDoc(zonaRef);
    Swal.fire({ text: "Zona eliminada correctamente", icon: "success", confirmButtonColor: "#16a34a" });
    renderizarListaZonas();
    cargarSelectsDeZonas();
    renderizarListaCompletaClientes();
    cargarEstadoCuentas();
    cargarPedidosAdmin();
  } catch (e) {
    console.error("Error eliminando zona: ", e);
    Swal.fire('Error', 'No se pudo eliminar la zona.', 'error');
  }
};

async function cargarSelectsDeZonas() {
  const selects = [
    document.getElementById('nuevaZona'),
    document.getElementById('adminZona'),
    document.getElementById('editZona')
  ];

  try {
    const querySnapshot = await getDocs(collection(db, "zonas"));
    const zonas = [];
    querySnapshot.forEach((docSnap) => {
      zonas.push(docSnap.data().nombre);
    });
    zonas.sort((a, b) => a.localeCompare(b));

    selects.forEach(select => {
      if (!select) return;
      const valorPrevio = select.value;
      select.innerHTML = '';
      zonas.forEach(z => {
        const option = document.createElement('option');
        option.value = z;
        option.textContent = z;
        select.appendChild(option);
      });
      if (valorPrevio && zonas.includes(valorPrevio)) select.value = valorPrevio;
    });
  } catch (error) {
    console.error("Error cargando selects de zonas:", error);
  }
}

const btnGuardarZona = document.getElementById('btnGuardarZona');
if (btnGuardarZona) {
  btnGuardarZona.addEventListener('click', async () => {
    const inputZona = document.getElementById('inputNuevaZona');
    const inputPrecio = document.getElementById('inputPrecioNuevaZona');
    const nombreZona = inputZona ? inputZona.value.trim() : '';
    const precioBalde = Number(inputPrecio?.value);

    if (!nombreZona) {
      Swal.fire({
        text: "Por favor ingresá un nombre para la zona.",
        icon: "warning",
        confirmButtonColor: "#eab308"
      });
      return;
    }

    if (!Number.isFinite(precioBalde) || precioBalde <= 0) {
      Swal.fire({
        text: "Ingresá un precio por balde mayor a 0.",
        icon: "warning",
        confirmButtonColor: "#eab308"
      });
      return;
    }

    try {
      await addDoc(collection(db, "zonas"), {
        nombre: nombreZona,
        precioBalde,
        creadoEn: serverTimestamp()
      });

      Swal.fire({
        text: `¡Zona "${nombreZona}" creada con precio ${formatearMoneda(precioBalde)} por balde!`,
        icon: "success",
        confirmButtonColor: "#16a34a"
      });

      inputZona.value = "";
      if (inputPrecio) inputPrecio.value = "";
      renderizarListaZonas();
      cargarSelectsDeZonas();
      renderizarListaCompletaClientes();
      cargarEstadoCuentas();
      cargarPedidosAdmin();

    } catch (error) {
      console.error("Error al crear la zona:", error);
      Swal.fire('Error', 'Hubo un problema al crear la zona.', 'error');
    }
  });
}

// ==========================================================
// 2. CREAR CLIENTE NUEVO
// ==========================================================
const btnCrearCliente = document.getElementById('btnCrearCliente');
if (btnCrearCliente) {
  btnCrearCliente.addEventListener('click', async () => {
    const nombre = capitalizarTexto(document.getElementById('nuevoNombre').value);
    const celuPrincipal = document.getElementById('nuevoCeluPrincipal').value.trim();
    const celuSecundario = document.getElementById('nuevoCeluSecundario').value.trim();
    const zona = document.getElementById('nuevaZona').value;
    const direccion = capitalizarTexto(document.getElementById('nuevaDireccion').value);

    const inputFecha = document.getElementById('nuevaFechaInicio');
    const fechaInicio = (inputFecha && inputFecha.value)
      ? inputFecha.value
      : new Date().toISOString().split('T')[0];

    if (!nombre || celuPrincipal.length !== 6 || isNaN(celuPrincipal)) {
      alert("Por favor completa el nombre y asegurate de ingresar 6 números en el celular principal.");
      return;
    }

    const celularesAsociados = [celuPrincipal];
    if (celuSecundario && celuSecundario.length === 6 && !isNaN(celuSecundario)) {
      celularesAsociados.push(celuSecundario);
    }

    try {
      const docRef = doc(db, "usuarios", celuPrincipal);
      const docSnap = await getDoc(docRef);

      if (docSnap.exists()) {
        Swal.fire({
          icon: 'warning',
          title: 'Celular Duplicado',
          text: '⚠️ Este número de celular ya está registrado. Para editar a este cliente, buscalo en la sección "Gestionar Cliente".',
          confirmButtonColor: '#eab308'
        });
        return;
      }

      await setDoc(docRef, {
        nombre: nombre,
        celu: celuPrincipal,
        celularesAsociados: celularesAsociados,
        zona: zona || "General",
        direccion: direccion || "Sin especificar",
        fechaInicioServicio: fechaInicio,
        totalKilos: 0,
        saldoPendiente: 0,
        baldesCompostados: 0,
        fechaAlta: serverTimestamp()
      });

      alert(`¡Cliente ${nombre} creado con éxito!`);

      document.getElementById('nuevoNombre').value = "";
      document.getElementById('nuevoCeluPrincipal').value = "";
      document.getElementById('nuevoCeluSecundario').value = "";
      document.getElementById('nuevaDireccion').value = "";
      if (inputFecha) inputFecha.value = "";

      await cargarClientesIniciales();
      renderizarListaCompletaClientes();
      cargarEstadoCuentas();

    } catch (error) {
      console.error("Error al crear cliente:", error);
      alert("Hubo un problema al crear el cliente.");
    }
  });
}

// ==========================================================
// 3. PUBLICAR Y GESTIONAR TURNOS DE RETIRO (GLOBAL)
// ==========================================================
const btnPublicarTurno = document.getElementById('btnPublicarTurno');
if (btnPublicarTurno) {
  btnPublicarTurno.addEventListener('click', async () => {
    const zona = document.getElementById('adminZona').value;
    const fechaVal = document.getElementById('adminFecha').value;
    const horaDesde = document.getElementById('adminHoraDesde').value;
    const horaHasta = document.getElementById('adminHoraHasta').value;
    const modoFraccionado = document.getElementById('adminFraccionar').value;

    if (!fechaVal || !horaDesde || !horaHasta) {
      alert("Completá la fecha y los horarios.");
      return;
    }

    const partes = fechaVal.split('-');
    const fechaFormateada = `${partes[2]}/${partes[1]}/${partes[0]}`;

    try {
      if (modoFraccionado === 'bloque') {
        const franjaHoraria = `${horaDesde} a ${horaHasta} hs`;
        await addDoc(collection(db, "disponibilidad"), {
          zona: zona,
          dia: fechaFormateada,
          fecha: fechaFormateada,
          horario: franjaHoraria,
          hora: franjaHoraria,
          creado: serverTimestamp()
        });
        alert("¡Turno bloque publicado con éxito!");
      } else {
        const intervaloMinutos = parseInt(modoFraccionado);
        let [hInicio, mInicio] = horaDesde.split(':').map(Number);
        let [hFin, mFin] = horaHasta.split(':').map(Number);

        let inicioEnMinutos = hInicio * 60 + mInicio;
        let finEnMinutos = hFin * 60 + mFin;

        if (inicioEnMinutos >= finEnMinutos) {
          alert("La hora de inicio debe ser menor a la hora de fin.");
          return;
        }

        let turnosCreados = 0;
        while (inicioEnMinutos + intervaloMinutos <= finEnMinutos) {
          let actualFinMinutos = inicioEnMinutos + intervaloMinutos;

          let hI = Math.floor(inicioEnMinutos / 60).toString().padStart(2, '0');
          let mI = (inicioEnMinutos % 60).toString().padStart(2, '0');
          let hF = Math.floor(actualFinMinutos / 60).toString().padStart(2, '0');
          let mF = (actualFinMinutos % 60).toString().padStart(2, '0');

          let franjaHoraria = `${hI}:${mI} a ${hF}:${mF} hs`;

          await addDoc(collection(db, "disponibilidad"), {
            zona: zona,
            dia: fechaFormateada,
            fecha: fechaFormateada,
            horario: franjaHoraria,
            hora: franjaHoraria,
            creado: serverTimestamp()
          });

          turnosCreados++;
          inicioEnMinutos = actualFinMinutos;
        }

        alert(`¡Se publicaron ${turnosCreados} turnos fraccionados con éxito!`);
      }

      document.getElementById('adminFecha').value = "";
      cargarTurnosAdmin();

    } catch (error) {
      console.error("Error al publicar turno:", error);
      alert("Hubo un error al intentar publicar los turnos.");
    }
  });
}

window.eliminarBloqueAdmin = async function (dia, zona, idsJSON) {
  if (!confirm(`¿Estás seguro de eliminar los turnos del ${dia} en ${zona}?`)) return;

  try {
    const ids = JSON.parse(idsJSON);
    for (const id of ids) {
      await deleteDoc(doc(db, "disponibilidad", id));
    }
    alert("Bloque de turnos eliminado.");
    cargarTurnosAdmin();
  } catch (error) {
    console.error("Error al eliminar bloque:", error);
    alert("Error al intentar eliminar los turnos.");
  }
};

async function cargarTurnosAdmin() {
  const contenedor = document.getElementById('contenedorListaTurnosAdmin');
  if (!contenedor) return;

  try {
    const querySnapshot = await getDocs(collection(db, "disponibilidad"));

    if (querySnapshot.empty) {
      contenedor.innerHTML = '<p class="admin-mensaje-vacio">No hay turnos cargados actualmente.</p>';
      return;
    }

    const grupos = {};

    querySnapshot.forEach((docSnap) => {
      const data = docSnap.data();
      const id = docSnap.id;
      const dia = data.dia || data.fecha || 'Sin Fecha';
      const zona = data.zona || 'General';
      const horario = data.horario || data.hora || '';

      const claveGrupo = `${dia}_${zona}`;

      if (!grupos[claveGrupo]) {
        grupos[claveGrupo] = { dia: dia, zona: zona, turnos: [] };
      }

      let horaInicio = "09:00";
      let horaFin = "13:00";
      const match = horario.match(/(\d{1,2}:\d{2})\s*(?:a|-)\s*(\d{1,2}:\d{2})/i);

      if (match) {
        const [hI, mI] = match[1].split(':');
        const [hF, mF] = match[2].split(':');
        horaInicio = `${hI.padStart(2, '0')}:${mI}`;
        horaFin = `${hF.padStart(2, '0')}:${mF}`;
      }

      grupos[claveGrupo].turnos.push({
        id: id,
        horario: horario,
        horaInicio: horaInicio,
        horaFin: horaFin
      });
    });

    let listaGrupos = Object.values(grupos);
    listaGrupos.sort((a, b) => {
      const partesA = a.dia.split('/');
      const partesB = b.dia.split('/');
      const fechaA = partesA.length === 3 ? `${partesA[2]}-${partesA[1]}-${partesA[0]}` : a.dia;
      const fechaB = partesB.length === 3 ? `${partesB[2]}-${partesB[1]}-${partesB[0]}` : b.dia;
      return fechaA.localeCompare(fechaB);
    });

    contenedor.innerHTML = "";
    listaGrupos.forEach((g, index) => {
      g.turnos.sort((a, b) => a.horaInicio.localeCompare(b.horaInicio));

      const primeraHora = g.turnos[0].horaInicio;
      const ultimaHora = g.turnos[g.turnos.length - 1].horaFin;
      const rangoTotal = `${primeraHora} a ${ultimaHora} hs`;
      const esFraccionado = g.turnos.length > 1;
      const idsArrayJSON = JSON.stringify(g.turnos.map(t => t.id)).replace(/"/g, '&quot;');

      contenedor.innerHTML += `
        <div id="tarjeta-bloque-${index}" class="turno-admin-card">
          <div id="vista-bloque-${index}">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <div>
                <strong style="font-size: 1.05rem; color: #1f2937;"><i class="ri-calendar-line"></i> ${g.dia}</strong> 
                <span style="background: #e5e7eb; padding: 2px 8px; border-radius: 12px; font-size: 0.85rem; margin-left: 8px;"><i class="ri-map-pin-line"></i> ${g.zona}</span>
                <br>
                <span style="color: #4b5563; font-size: 0.95rem; display: inline-block; margin-top: 4px;"><i class="ri-time-line"></i> Horario: <strong>${rangoTotal}</strong></span>
                <br>
                <small style="color: #6b7280; font-size: 0.85rem;">
                  ${esFraccionado ? `Dividido en ${g.turnos.length} franjas` : 'Bloque completo único'}
                </small>
              </div>
              <div>
                <button onclick="eliminarBloqueAdmin('${g.dia}', '${g.zona}', '${idsArrayJSON}')" style="background: #dc2626; color: #fff; border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer;"><i class="ri-delete-bin-line"></i> Eliminar</button>
              </div>
            </div>
          </div>
        </div>
      `;
    });

  } catch (error) {
    console.error("Error al obtener turnos para admin:", error);
    contenedor.innerHTML = '<p class="admin-mensaje-error">Error al obtener la lista de turnos.</p>';
  }
}

const btnLimpiar = document.getElementById('btnLimpiarTurnosPasados');
if (btnLimpiar) {
  btnLimpiar.addEventListener('click', async () => {
    if (!confirm("¿Querés eliminar permanentemente todos los turnos anteriores a la fecha de hoy?")) return;

    try {
      const querySnapshot = await getDocs(collection(db, "disponibilidad"));
      const hoy = new Date();
      const aAAA = hoy.getFullYear();
      const mm = String(hoy.getMonth() + 1).padStart(2, '0');
      const dd = String(hoy.getDate()).padStart(2, '0');
      const hoyStr = `${aAAA}-${mm}-${dd}`;

      let eliminados = 0;

      for (const docSnap of querySnapshot.docs) {
        const data = docSnap.data();
        const fechaTurno = normalizarFechaTurno(data.dia || data.fecha);

        if (fechaTurno < hoyStr) {
          await deleteDoc(doc(db, "disponibilidad", docSnap.id));
          eliminados++;
        }
      }

      if (eliminados > 0) {
        alert(`Se eliminaron ${eliminados} turno(s) pasado(s).`);
      } else {
        alert("No se encontraron turnos pasados.");
      }

      cargarTurnosAdmin();
    } catch (error) {
      console.error("Error al limpiar turnos pasados:", error);
      alert("Error al intentar limpiar los turnos pasados.");
    }
  });
}

// ==========================================================
// 4. BUSCADOR INTELIGENTE Y SELECCIÓN DE CLIENTE
// ==========================================================
async function cargarClientesIniciales() {
  try {
    const q = query(collection(db, "usuarios"), limit(300));
    const querySnapshot = await getDocs(q);

    ultimosClientes = [];
    querySnapshot.forEach((docSnap) => {
      if (docSnap.id !== 'admin') {
        ultimosClientes.push({ id: docSnap.id, ...docSnap.data() });
      }
    });
  } catch (error) {
    console.error("Error cargando base de clientes:", error);
  }
}

function inicializarBuscadorClientes() {
  const buscador = document.getElementById('buscarClienteInput');
  const resultados = document.getElementById('resultadosBusquedaAdmin');
  if (!buscador || !resultados) return;

  buscador.addEventListener('input', async (e) => {
    const texto = e.target.value.toLowerCase().trim();
    resultados.innerHTML = '';

    if (texto.length === 0) {
      resultados.style.display = 'none';
      return;
    }

    let filtrados = ultimosClientes.filter(c =>
      (c.nombre && c.nombre.toLowerCase().includes(texto)) || c.id.includes(texto)
    );

    if (filtrados.length === 0 && texto.length === 6 && !isNaN(texto)) {
      resultados.innerHTML = '<div class="item-resultado">Buscando en base de datos...</div>';
      resultados.style.display = 'block';

      try {
        const docSnap = await getDoc(doc(db, "usuarios", texto));
        if (docSnap.exists() && docSnap.id !== 'admin') {
          filtrados = [{ id: docSnap.id, ...docSnap.data() }];
        }
      } catch (error) {
        console.error(error);
      }
      resultados.innerHTML = '';
    }

    if (filtrados.length > 0) {
      filtrados.forEach(c => {
        const div = document.createElement('div');
        div.className = 'item-resultado';
        div.style.padding = '8px 12px';
        div.style.cursor = 'pointer';
        div.style.borderBottom = '1px solid #e2e8f0';
        div.innerHTML = `<strong>${c.nombre || 'Sin nombre'}</strong> (${c.id}) - Actual: ${c.totalKilos || 0}kg`;
        div.onclick = () => seleccionarCliente(c);
        resultados.appendChild(div);
      });
      resultados.style.display = 'block';
    } else {
      resultados.innerHTML = '<div class="item-resultado texto-suave resultado-no-encontrado">No encontrado. Revisá los datos.</div>';
      resultados.style.display = 'block';
    }
  });
}

async function refrescarClienteActual() {
  const clienteId = document.getElementById('clienteSeleccionadoId')?.value;
  if (!clienteId) return;

  try {
    const docSnap = await getDoc(doc(db, "usuarios", clienteId));
    if (docSnap.exists()) {
      seleccionarCliente({ id: docSnap.id, ...docSnap.data() });
    }
  } catch (error) {
    console.error("Error al refrescar la tarjeta del cliente:", error);
  }
}

function seleccionarCliente(cliente) {
  const inputId = document.getElementById('clienteSeleccionadoId');
  if (inputId) inputId.value = cliente.id;

  const textoSeleccionado = document.getElementById('textoClienteSeleccionado');
  if (textoSeleccionado) {
    const fechaInicioFmt = formatearFechaVista(cliente.fechaInicioServicio);
    const celuSec = (cliente.celularesAsociados && cliente.celularesAsociados.length > 1)
      ? ` / 2do: ${cliente.celularesAsociados[1]}`
      : '';

    textoSeleccionado.innerHTML = `
      <div class="cliente-admin-resumen-dinamico">
        <h3 class="cliente-admin-titulo">
          <i class="ri-user-star-fill icono-violeta"></i> <strong>${cliente.nombre || 'Sin nombre'}</strong> 
          <span class="cliente-admin-id">(ID/Cel: ${cliente.id}${celuSec})</span>
        </h3>
        
        <div class="cliente-admin-meta">
          <span>📅 <strong>Fecha Inicio:</strong> ${fechaInicioFmt}</span>
          <span>|</span>
          <span>📍 <strong>Zona:</strong> ${cliente.zona || 'General'}</span>
          <span>|</span>
          <span>🪣 <strong>Valor por balde:</strong> <span id="precioBaldeClienteAdmin">Cargando...</span></span>
          <span>|</span>
          <span>🏠 <strong>Dirección:</strong> ${cliente.direccion || 'Sin especificar'}</span>
        </div>

        <div class="cliente-admin-metricas">
          <span><i class="ri-scales-3-line icono-menta"></i> Kilos: <strong>${Number(cliente.totalKilos || 0).toFixed(1)} kg</strong></span>
          <span><i class="ri-delete-bin-6-line icono-naranja"></i> Baldes: <strong>${cliente.baldesCompostados || 0}</strong></span>
          <span><i class="ri-money-dollar-box-line icono-verde"></i> Saldo: <strong class="${cliente.saldoPendiente > 0 ? 'saldo-dinamico-pendiente' : 'saldo-dinamico-ok'}">$${cliente.saldoPendiente || 0}</strong></span>
        </div>
      </div>
    `;
  }

  const selectZona = document.getElementById('editZona');
  const inputDireccion = document.getElementById('editDireccion');
  const inputCeluSecundario = document.getElementById('editCeluSecundario');
  const inputBaldes = document.getElementById('editBaldes');
  const inputEditFecha = document.getElementById('editFechaInicio');

  if (selectZona) selectZona.value = cliente.zona || 'General';
  if (inputDireccion) inputDireccion.value = cliente.direccion || '';
  if (inputBaldes) inputBaldes.value = cliente.baldesCompostados || 0;
  if (inputEditFecha) inputEditFecha.value = cliente.fechaInicioServicio || '';

  const secundario = (cliente.celularesAsociados && cliente.celularesAsociados.length > 1)
    ? cliente.celularesAsociados[1]
    : '';
  if (inputCeluSecundario) inputCeluSecundario.value = secundario;

  const inputKilosASumar = document.getElementById('kilosASumarInput');
  const inputBaldesASumar = document.getElementById('baldesASumarInput');
  if (inputKilosASumar) inputKilosASumar.value = '0';
  if (inputBaldesASumar) inputBaldesASumar.value = '0';

  const formEdicion = document.getElementById('formEditarPerfilCliente');
  const cajaCliente = document.getElementById('cajaClienteSeleccionadoAdmin');
  const resultados = document.getElementById('resultadosBusquedaAdmin');

  if (formEdicion) formEdicion.style.display = 'none';
  if (cajaCliente) cajaCliente.style.display = 'block';
  if (resultados) resultados.style.display = 'none';

  cargarResumenEconomicoClienteAdmin(cliente);
}

async function cargarResumenEconomicoClienteAdmin(cliente) {
  const precioEl = document.getElementById('precioBaldeClienteAdmin');
  const contenedor = document.getElementById('contenedorDeudasClienteAdmin');
  if (contenedor) contenedor.innerHTML = '<p class="texto-suave">Cargando cuenta del cliente...</p>';

  try {
    // Lectura normalizada de zonas
    const mapaPrecios = await obtenerMapaPreciosZonas();
    const precioActual = Number(mapaPrecios.get(claveZona(cliente.zona)) || 0);

    if (precioEl) {
      precioEl.textContent = precioActual > 0 ? formatearMoneda(precioActual) : 'Sin configurar';
      precioEl.style.color = precioActual > 0 ? '#0f766e' : '#dc2626';
      precioEl.style.fontWeight = '700';
    }

    if (!contenedor) return;

    const qRecolecciones = query(
      collection(db, 'recolecciones'),
      where('clienteId', '==', cliente.id)
    );
    const snap = await getDocs(qRecolecciones);
    const pendientes = [];

    snap.forEach(docSnap => {
      const r = { id: docSnap.id, ...docSnap.data() };
      if ((r.estadoPago || '').toLowerCase() === 'pendiente') pendientes.push(r);
    });

    pendientes.sort((a, b) => (b.fechaRetiro?.seconds || 0) - (a.fechaRetiro?.seconds || 0));

    if (pendientes.length === 0) {
      contenedor.innerHTML = `
        <div class="cuenta-al-dia-admin">
          <i class="ri-checkbox-circle-line"></i>
          <div><strong>Cuenta al día</strong><br><span>No hay recolecciones pendientes de pago.</span></div>
        </div>
      `;
      return;
    }

    const totalPendiente = pendientes.reduce((acc, r) => acc + Number(r.total || 0), 0);
    let html = `
      <div class="resumen-deuda-admin">
        <span>Saldo pendiente registrado</span>
        <strong>${formatearMoneda(totalPendiente)}</strong>
      </div>
      <div class="lista-deudas-admin">
    `;

    pendientes.forEach(r => {
      html += `
        <div class="item-deuda-admin">
          <div>
            <strong>${formatearFechaTimestamp(r.fechaRetiro)} · ${Number(r.cantidadBaldes || 0)} balde${Number(r.cantidadBaldes || 0) === 1 ? '' : 's'}</strong>
            <span>${formatearMoneda(r.precioUnitario || 0)} c/u · Total ${formatearMoneda(r.total || 0)}</span>
          </div>
          <button type="button" class="btn-app btn-marcar-pagado" onclick="marcarRecoleccionPagada('${r.id}', '${cliente.id}')">
            <i class="ri-check-double-line"></i> Marcar pagado
          </button>
        </div>
      `;
    });

    html += '</div>';
    contenedor.innerHTML = html;
  } catch (error) {
    console.error('Error cargando resumen económico del cliente:', error);
    if (contenedor) contenedor.innerHTML = '<p class="admin-mensaje-error">No se pudo cargar el detalle de pagos.</p>';
  }
}

window.marcarRecoleccionPagada = async function (recoleccionId, clienteId) {
  const confirmacion = await Swal.fire({
    title: '¿Registrar pago?',
    text: 'Esta recolección dejará de figurar como deuda pendiente.',
    icon: 'question',
    showCancelButton: true,
    confirmButtonText: 'Sí, ya pagó',
    cancelButtonText: 'Cancelar',
    confirmButtonColor: '#16a34a'
  });

  if (!confirmacion.isConfirmed) return;

  try {
    await runTransaction(db, async (transaction) => {
      const recoleccionRef = doc(db, 'recolecciones', recoleccionId);
      const usuarioRef = doc(db, 'usuarios', clienteId);
      const [recoleccionSnap, usuarioSnap] = await Promise.all([
        transaction.get(recoleccionRef),
        transaction.get(usuarioRef)
      ]);

      if (!recoleccionSnap.exists()) throw new Error('La recolección no existe.');
      if (!usuarioSnap.exists()) throw new Error('El cliente no existe.');

      const recoleccion = recoleccionSnap.data();
      if ((recoleccion.estadoPago || '').toLowerCase() === 'pagado') return;

      const monto = Number(recoleccion.total || 0);
      const saldoActual = Number(usuarioSnap.data().saldoPendiente || 0);

      transaction.update(recoleccionRef, {
        estadoPago: 'pagado',
        fechaPago: serverTimestamp()
      });
      transaction.update(usuarioRef, {
        saldoPendiente: Math.max(0, saldoActual - monto)
      });
    });

    Swal.fire({ icon: 'success', title: 'Pago registrado', timer: 1400, showConfirmButton: false });
    await refrescarClienteActual();
    await cargarClientesIniciales();
    renderizarListaCompletaClientes();
    cargarEstadoCuentas();
    cargarPedidosAdmin();
  } catch (error) {
    console.error('Error registrando pago:', error);
    Swal.fire('Error', error.message || 'No se pudo registrar el pago.', 'error');
  }
};

document.getElementById('btnToggleEditarCliente')?.addEventListener('click', () => {
  const form = document.getElementById('formEditarPerfilCliente');
  if (form) form.style.display = form.style.display === 'none' ? 'block' : 'none';
});

const resetearSeleccionCliente = () => {
  const inputBusqueda = document.getElementById('buscarClienteInput');
  const inputId = document.getElementById('clienteSeleccionadoId');
  const cajaCliente = document.getElementById('cajaClienteSeleccionadoAdmin');
  const resultados = document.getElementById('resultadosBusquedaAdmin');

  if (inputBusqueda) inputBusqueda.value = '';
  if (inputId) inputId.value = '';
  if (cajaCliente) cajaCliente.style.display = 'none';
  if (resultados) resultados.style.display = 'none';
  if (inputBusqueda) inputBusqueda.focus();
};

document.getElementById('btnBuscarOtroCliente')?.addEventListener('click', resetearSeleccionCliente);

// ==========================================================
// 4. GUARDAR EDICIÓN DE DATOS DE CLIENTE
// ==========================================================
const btnGuardarEdicion = document.getElementById('btnGuardarEdicion');
if (btnGuardarEdicion) {
  btnGuardarEdicion.addEventListener('click', async () => {
    const clienteId = document.getElementById('clienteSeleccionadoId')?.value;
    const nuevaZona = document.getElementById('editZona')?.value;
    const nuevaDireccion = capitalizarTexto(document.getElementById('editDireccion')?.value);
    const nuevosBaldes = parseInt(document.getElementById('editBaldes')?.value) || 0;
    const inputSecundario = document.getElementById('editCeluSecundario');
    const nuevoCeluSecundario = inputSecundario ? inputSecundario.value.trim() : '';

    const inputFecha = document.getElementById('editFechaInicio');
    const nuevaFechaInicio = inputFecha ? inputFecha.value : null;

    if (!clienteId) {
      Swal.fire('Atención', 'Primero buscá y seleccioná un cliente.', 'warning');
      return;
    }

    const celularesAsociados = [clienteId];
    if (nuevoCeluSecundario.length === 6 && !isNaN(nuevoCeluSecundario)) {
      celularesAsociados.push(nuevoCeluSecundario);
    }

    try {
      const userRef = doc(db, "usuarios", clienteId);
      const updatePayload = {
        zona: nuevaZona,
        direccion: nuevaDireccion || "Sin especificar",
        baldesCompostados: nuevosBaldes,
        celularesAsociados: celularesAsociados
      };

      if (nuevaFechaInicio) {
        updatePayload.fechaInicioServicio = nuevaFechaInicio;
      }

      await updateDoc(userRef, updatePayload);

      Swal.fire('¡Cliente actualizado!', 'Los datos del perfil fueron guardados exitosamente.', 'success');
      await refrescarClienteActual();
      await cargarClientesIniciales();
      renderizarListaCompletaClientes();
      cargarEstadoCuentas();
      cargarPedidosAdmin();
    } catch (error) {
      console.error("Error al actualizar cliente:", error);
      Swal.fire('Error', 'No se pudieron guardar los cambios.', 'error');
    }
  });
}

// ==========================================================
// 5. ELIMINAR CLIENTE
// ==========================================================
const btnEliminar = document.getElementById('btnEliminarCliente');
if (btnEliminar) {
  btnEliminar.addEventListener('click', async () => {
    const clienteId = document.getElementById('clienteSeleccionadoId')?.value;

    if (!clienteId) {
      Swal.fire('Atención', 'Primero seleccioná un cliente para eliminar.', 'warning');
      return;
    }

    const confirmacion = await Swal.fire({
      title: '¿Eliminar cliente?',
      text: `Esta acción borrará permanentemente al cliente ID: ${clienteId}.`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#dc2626',
      cancelButtonColor: '#64748b',
      confirmButtonText: 'Sí, eliminar',
      cancelButtonText: 'Cancelar'
    });

    if (confirmacion.isConfirmed) {
      try {
        await deleteDoc(doc(db, "usuarios", clienteId));
        Swal.fire('Eliminado', 'El cliente fue eliminado de la base de datos.', 'success');

        resetearSeleccionCliente();
        await cargarClientesIniciales();
        renderizarListaCompletaClientes();
        cargarEstadoCuentas();
      } catch (error) {
        console.error("Error al eliminar cliente:", error);
        Swal.fire('Error', 'Hubo un problema al intentar eliminar el cliente.', 'error');
      }
    }
  });
}

// ==========================================================
// 6. ACCIONES RÁPIDAS (KILOS / BALDES) + HISTORIAL ANUAL
// ==========================================================
const btnSumarKilosYBaldes = document.getElementById('btnSumarKilosYBaldes');
if (btnSumarKilosYBaldes) {
  btnSumarKilosYBaldes.addEventListener('click', async () => {
    const clienteId = document.getElementById('clienteSeleccionadoId')?.value;
    const kilosNuevos = parseFloat(document.getElementById('kilosASumarInput')?.value) || 0;
    const baldesNuevos = parseInt(document.getElementById('baldesASumarInput')?.value) || 0;

    if (!clienteId) {
      Swal.fire('Atención', 'Primero seleccioná un cliente.', 'warning');
      return;
    }

    if (kilosNuevos <= 0 && baldesNuevos <= 0) {
      Swal.fire('Atención', 'Ingresá cantidad de kilos o baldes para sumar.', 'warning');
      return;
    }

    try {
      const userRef = doc(db, "usuarios", clienteId);
      const payload = {};
      if (kilosNuevos > 0) payload.totalKilos = increment(kilosNuevos);
      if (baldesNuevos > 0) payload.baldesCompostados = increment(baldesNuevos);

      const añoActual = new Date().getFullYear().toString();
      await addDoc(collection(db, "historial_impacto"), {
        clienteId: clienteId,
        kilos: kilosNuevos,
        baldes: baldesNuevos,
        anio: añoActual,
        fecha: serverTimestamp()
      });

      await updateDoc(userRef, payload);

      Swal.fire('¡Registrado!', 'Los kilos y baldes se sumaron correctamente.', 'success');
      document.getElementById('kilosASumarInput').value = '0';
      document.getElementById('baldesASumarInput').value = '0';

      await refrescarClienteActual();
      await cargarClientesIniciales();
      renderizarListaCompletaClientes();
      cargarEstadoCuentas();
    } catch (error) {
      console.error("Error al sumar kilos/baldes:", error);
      Swal.fire('Error', 'No se pudo actualizar los kilos/baldes.', 'error');
    }
  });
}

// ==========================================================
// 7. HOJA DE RUTA ACTIVADA - AGRUPADA Y ORDENADA POR ZONA/FECHA
// ==========================================================
let ultimosPedidosHojaRuta = [];

function procesarFechaHoraTurno(strTurno) {
  if (!strTurno) return { fechaIso: "9999-99-99", horaInicio: "23:59" };

  let fechaIso = "9999-99-99";
  let horaInicio = "23:59";

  const matchFecha = strTurno.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (matchFecha) {
    const dia = matchFecha[1].padStart(2, '0');
    const mes = matchFecha[2].padStart(2, '0');
    const anio = matchFecha[3];
    fechaIso = `${anio}-${mes}-${dia}`;
  }

  const matchHora = strTurno.match(/(\d{2}:\d{2})/);
  if (matchHora) {
    horaInicio = matchHora[1];
  }

  return { fechaIso, horaInicio };
}

function limpiarHorarioTurno(strTurno) {
  if (!strTurno) return 'Sin horario';
  return strTurno.replace(/^\d{1,2}\/\d{1,2}(\/\d{2,4})?\s*[-–]?\s*/, '').trim();
}

async function cargarPedidosAdmin() {
  const tbody = document.getElementById('tablaHojaRutaBody') || document.getElementById('listaPedidosAdmin');
  if (!tbody) return;

  tbody.innerHTML = `
    <tr>
      <td colspan="4" class="texto-suave admin-estado-tabla">
        Cargando hoja de ruta...
      </td>
    </tr>
  `;

  try {
    let q = query(collection(db, "pedidos_retiro"), where("estado", "in", ["Pendiente", "pendiente"]));
    let querySnapshot = await getDocs(q);

    if (querySnapshot.empty) {
      q = query(collection(db, "pedidos"), where("estado", "in", ["Pendiente", "pendiente"]));
      querySnapshot = await getDocs(q);
    }

    if (querySnapshot.empty) {
      tbody.innerHTML = `
        <tr>
          <td colspan="4" class="texto-suave admin-estado-tabla">
            No hay retiros pendientes programados.
          </td>
        </tr>
      `;
      ultimosPedidosHojaRuta = [];
      return;
    }

    let pedidos = [];
    querySnapshot.forEach((docSnap) => {
      pedidos.push({ id: docSnap.id, ...docSnap.data() });
    });

    const [usuariosSnap, zonasSnap] = await Promise.all([
      getDocs(collection(db, 'usuarios')),
      getDocs(collection(db, 'zonas'))
    ]);

    const clientesPorId = new Map();
    usuariosSnap.forEach(docSnap => {
      if (docSnap.id !== 'admin') clientesPorId.set(docSnap.id, { id: docSnap.id, ...docSnap.data() });
    });

    const preciosPorZona = new Map();
    zonasSnap.forEach(docSnap => {
      const zona = docSnap.data();
      preciosPorZona.set(claveZona(zona.nombre), Number(zona.precioBalde || 0));
    });

    pedidos = pedidos.map(p => {
      const clienteId = p.clienteId || p.clienteCelu || p.celular || '';
      const cliente = clientesPorId.get(clienteId);
      const zonaNombre = cliente?.zona || p.zona || p.clienteZona || 'General';
      return {
        ...p,
        _precioBaldeActual: Number(preciosPorZona.get(claveZona(zonaNombre)) || 0),
        _saldoPendienteActual: Number(cliente?.saldoPendiente || 0)
      };
    });

    ultimosPedidosHojaRuta = pedidos;

    const mapDias = {};

    pedidos.forEach(p => {
      const turnoVal = p.turnoElegido || p.turno || p.fechaHora || '';
      const { fechaIso, horaInicio } = procesarFechaHoraTurno(turnoVal);

      const matchFecha = turnoVal.match(/(\d{1,2}\/\d{1,2}\/\d{4})/);
      const fechaTexto = matchFecha ? matchFecha[1] : (fechaIso !== "9999-99-99" ? fechaIso : "Fecha a Confirmar");
      const zonaNombre = (p.zona || p.clienteZona || 'General').trim();

      if (!mapDias[fechaIso]) {
        mapDias[fechaIso] = {
          fechaTexto: fechaTexto,
          zonas: {}
        };
      }

      if (!mapDias[fechaIso].zonas[zonaNombre]) {
        mapDias[fechaIso].zonas[zonaNombre] = [];
      }

      mapDias[fechaIso].zonas[zonaNombre].push({
        ...p,
        horaInicio: horaInicio
      });
    });

    tbody.innerHTML = "";

    const fechasOrdenadas = Object.keys(mapDias).sort();

    fechasOrdenadas.forEach(fechaIso => {
      const grupoDia = mapDias[fechaIso];

      tbody.innerHTML += `
        <tr class="ruta-dia-row">
          <td colspan="4" class="ruta-dia-cell">
            <i class="ri-calendar-event-fill ruta-icono-dia"></i> DÍA: ${grupoDia.fechaTexto}
          </td>
        </tr>
      `;

      const zonasOrdenadas = Object.keys(grupoDia.zonas).sort();

      zonasOrdenadas.forEach(zona => {
        const listaPedidosZona = grupoDia.zonas[zona];
        listaPedidosZona.sort((a, b) => a.horaInicio.localeCompare(b.horaInicio));

        tbody.innerHTML += `
          <tr class="ruta-zona-row">
            <td colspan="4" class="ruta-zona-cell">
              <i class="ri-map-pin-2-fill ruta-icono-zona"></i> ZONA: ${zona.toUpperCase()} (${listaPedidosZona.length})
            </td>
          </tr>
        `;

        listaPedidosZona.forEach(p => {
          const turnoVal = p.turnoElegido || p.turno || p.fechaHora || 'Sin turno';
          const horarioLimpio = limpiarHorarioTurno(turnoVal);
          const nombreVal = p.nombre || p.clienteNombre || 'Sin nombre';
          const direccionVal = p.direccion || p.clienteDireccion || 'Sin dirección';
          const precioRuta = Number(p._precioBaldeActual || 0);
          const saldoPrevio = Number(p._saldoPendienteActual || 0);
          const textoPrecio = precioRuta > 0 ? `${formatearMoneda(precioRuta)}/balde` : 'Precio sin configurar';
          const textoSaldo = saldoPrevio > 0
            ? `<span class="ruta-saldo-pendiente">⚠️ Saldo anterior: ${formatearMoneda(saldoPrevio)}</span>`
            : `<span class="ruta-saldo-ok">✅ Cuenta al día</span>`;

          tbody.innerHTML += `
            <tr id="pedido-${p.id}" class="ruta-pedido-row">
              <td class="ruta-pedido-cliente">
                <strong class="ruta-pedido-nombre">${nombreVal}</strong>
                <div class="ruta-pedido-subtexto">🪣 ${textoPrecio} · ${textoSaldo}</div>
              </td>
              <td class="ruta-pedido-direccion">
                ${direccionVal}
              </td>
              <td class="ruta-pedido-turno">
                ${horarioLimpio}
              </td>
              <td class="ruta-pedido-accion">
                <button class="btn-completar-mini btn-completar-ruta" onclick="marcarPedidoCompletado('${p.id}')" title="Marcar como retirado">
                  ✓ Retirado
                </button>
              </td>
            </tr>
          `;
        });
      });
    });

  } catch (error) {
    console.error("Error al cargar pedidos:", error);
    tbody.innerHTML = `
      <tr>
        <td colspan="4" class="admin-estado-error-tabla">
          Error al cargar los pedidos.
        </td>
      </tr>
    `;
  }
}

window.cargarHojaRutaAdmin = cargarPedidosAdmin;

window.marcarPedidoCompletado = async function (pedidoId) {
  try {
    let pedidoRef = doc(db, 'pedidos_retiro', pedidoId);
    let pedidoSnap = await getDoc(pedidoRef);

    if (!pedidoSnap.exists()) {
      pedidoRef = doc(db, 'pedidos', pedidoId);
      pedidoSnap = await getDoc(pedidoRef);
    }

    if (!pedidoSnap.exists()) {
      Swal.fire('Atención', 'No se encontró el pedido.', 'warning');
      return;
    }

    const pedido = pedidoSnap.data();
    if ((pedido.estado || '').toLowerCase() === 'completado') {
      Swal.fire('Atención', 'Este retiro ya fue registrado.', 'info');
      cargarPedidosAdmin();
      return;
    }

    const clienteId = pedido.clienteId || pedido.clienteCelu;
    if (!clienteId) {
      Swal.fire('Error', 'El pedido no tiene un cliente asociado.', 'error');
      return;
    }

    const clienteSnap = await getDoc(doc(db, 'usuarios', clienteId));
    if (!clienteSnap.exists()) {
      Swal.fire('Error', 'No se encontró el perfil del cliente.', 'error');
      return;
    }

    const cliente = clienteSnap.data();
    const zonaNombre = cliente.zona || pedido.zona || pedido.clienteZona || 'General';
    const zona = await obtenerZonaPorNombre(zonaNombre);
    const precioBalde = Number(zona?.precioBalde || 0);

    if (!zona || precioBalde <= 0) {
      Swal.fire({
        title: 'Falta configurar el precio',
        html: `La zona <strong>${zonaNombre}</strong> todavía no tiene un precio por balde válido.<br><br>Configurá el precio desde <strong>Gestionar Zonas del Servicio</strong> antes de registrar este retiro.`,
        icon: 'warning',
        confirmButtonColor: '#eab308'
      });
      return;
    }

    const cantidadInicial = Math.max(1, Number(pedido.cantBaldes || 1));
    const nombreCliente = pedido.nombre || pedido.clienteNombre || cliente.nombre || 'Cliente';

    const confirmacion = await Swal.fire({
      title: 'Confirmar recolección',
      html: `
        <div class="swal-form-grid">
          <div class="swal-resumen-retiro">
            <strong>${nombreCliente}</strong><br>
            <span>📍 ${zonaNombre}</span><br>
            <span>🪣 Precio actual: <strong>${formatearMoneda(precioBalde)}</strong> por balde</span>
          </div>

          <label for="swalCantBaldes" class="swal-label-bloque">Baldes retirados</label>
          <input id="swalCantBaldes" type="number" min="1" max="50" step="1" value="${cantidadInicial}" class="swal2-input swal-control-ancho">

          <label for="swalEstadoPago" class="swal-label-bloque">Estado del pago</label>
          <select id="swalEstadoPago" class="swal2-select swal-control-ancho">
            <option value="pagado">✅ Cobrado en el momento</option>
            <option value="pendiente">⏳ Quedó pendiente de pago</option>
          </select>

          <div class="swal-total-retiro">
            <span>Total de la recolección</span>
            <strong id="swalTotalRetiro">${formatearMoneda(cantidadInicial * precioBalde)}</strong>
          </div>
          <p class="swal-nota-retiro">Registrar este retiro no modifica automáticamente los baldes compostados ni los kilos del perfil.</p>
        </div>
      `,
      showCancelButton: true,
      confirmButtonColor: '#16a34a',
      cancelButtonColor: '#64748b',
      confirmButtonText: 'Registrar retiro',
      cancelButtonText: 'Cancelar',
      didOpen: () => {
        const inputCantidad = document.getElementById('swalCantBaldes');
        const totalEl = document.getElementById('swalTotalRetiro');
        inputCantidad?.addEventListener('input', () => {
          const cantidad = Math.max(0, Number(inputCantidad.value || 0));
          if (totalEl) totalEl.textContent = formatearMoneda(cantidad * precioBalde);
        });
      },
      preConfirm: () => {
        const cantidad = Number(document.getElementById('swalCantBaldes')?.value);
        const estadoPago = document.getElementById('swalEstadoPago')?.value;

        if (!Number.isInteger(cantidad) || cantidad <= 0) {
          Swal.showValidationMessage('Ingresá una cantidad válida de baldes.');
          return false;
        }
        if (!['pagado', 'pendiente'].includes(estadoPago)) {
          Swal.showValidationMessage('Seleccioná el estado del pago.');
          return false;
        }

        return { cantidad, estadoPago };
      }
    });

    if (!confirmacion.isConfirmed) return;

    const { cantidad, estadoPago } = confirmacion.value;
    const total = cantidad * precioBalde;
    const recoleccionRef = doc(collection(db, 'recolecciones'));
    const usuarioRef = doc(db, 'usuarios', clienteId);

    await runTransaction(db, async (transaction) => {
      const [pedidoActualSnap, usuarioActualSnap] = await Promise.all([
        transaction.get(pedidoRef),
        transaction.get(usuarioRef)
      ]);

      if (!pedidoActualSnap.exists()) throw new Error('El pedido ya no existe.');
      if (!usuarioActualSnap.exists()) throw new Error('El cliente ya no existe.');
      if ((pedidoActualSnap.data().estado || '').toLowerCase() === 'completado') {
        throw new Error('Este retiro ya había sido registrado.');
      }

      const saldoActual = Number(usuarioActualSnap.data().saldoPendiente || 0);

      transaction.set(recoleccionRef, {
        clienteId,
        clienteNombre: nombreCliente,
        pedidoId,
        zona: zonaNombre,
        cantidadBaldes: cantidad,
        precioUnitario: precioBalde,
        total,
        estadoPago,
        turno: pedido.turnoElegido || pedido.turno || pedido.fechaHora || '',
        notaEntrega: pedido.nota || '',
        fechaRetiro: serverTimestamp(),
        fechaPago: estadoPago === 'pagado' ? serverTimestamp() : null,
        creadoEn: serverTimestamp()
      });

      transaction.update(pedidoRef, {
        estado: 'Completado',
        fechaCompletado: serverTimestamp(),
        recoleccionId: recoleccionRef.id,
        cantBaldesRetirados: cantidad,
        precioBaldeAplicado: precioBalde,
        totalRecoleccion: total,
        estadoPago
      });

      if (estadoPago === 'pendiente') {
        transaction.update(usuarioRef, {
          saldoPendiente: saldoActual + total
        });
      }
    });

    Swal.fire({
      icon: 'success',
      title: estadoPago === 'pendiente' ? 'Retiro registrado con saldo pendiente' : 'Retiro registrado y cobrado',
      html: `<strong>Total: ${formatearMoneda(total)}</strong>`,
      timer: 1800,
      showConfirmButton: false
    });

    cargarPedidosAdmin();
    await cargarClientesIniciales();
    renderizarListaCompletaClientes();
    cargarEstadoCuentas();
  } catch (err) {
    console.error('Error al registrar recolección:', err);
    Swal.fire('Error', err.message || 'No se pudo registrar el retiro.', 'error');
  }
};

window.descargarHojaDeRutaCSV = function () {
  if (!ultimosPedidosHojaRuta || ultimosPedidosHojaRuta.length === 0) {
    Swal.fire('Atención', 'No hay pedidos de retiro pendientes para descargar.', 'warning');
    return;
  }

  let csvContent = "\uFEFF";
  csvContent += "Zona;Cliente;Celular;Direccion;Turno;Cant. Baldes;Precio por balde ($);Saldo anterior ($);Nota/Entrega;Estado\r\n";

  ultimosPedidosHojaRuta.forEach(p => {
    const zona = escaparCSV(p.zona || p.clienteZona || 'General');
    const cliente = escaparCSV(p.nombre || p.clienteNombre || 'Sin nombre');
    const celu = escaparCSV(p.clienteCelu || p.celular || p.clienteId || '');
    const direccion = escaparCSV(p.direccion || p.clienteDireccion || 'Sin direccion');
    const turno = escaparCSV(p.turnoElegido || p.turno || p.fechaHora || '');
    const baldes = Number(p.cantBaldes || 1);
    const precioBalde = Number(p._precioBaldeActual || 0);
    const saldoAnterior = Number(p._saldoPendienteActual || 0);
    const nota = escaparCSV(p.nota || p.observaciones || '');
    const estado = escaparCSV(p.estado || 'Pendiente');

    csvContent += `"${zona}";"${cliente}";"${celu}";"${direccion}";"${turno}";"${baldes}";"${precioBalde}";"${saldoAnterior}";"${nota}";"${estado}"\r\n`;
  });

  descargarArchivoCSV(csvContent, `hoja_de_ruta_${new Date().toISOString().slice(0, 10)}.csv`);
};

// ==========================================================
// 8. TABLA GENERAL DE CLIENTES REGISTRADOS (CON PAGINACIÓN)
// ==========================================================
let ultimoDocClientePaginado = null;
let clientesPaginadosCache = [];
const TAMANIO_PAGINA_CLIENTES = 20;

async function renderizarListaCompletaClientes(cargarMas = false) {
  const contenedor = document.getElementById('contenedorListaClientes');
  const btnCargarMas = document.getElementById('btnCargarMasClientes');
  if (!contenedor) return;

  if (!cargarMas) {
    contenedor.innerHTML = '<p class="texto-suave">Cargando lista de clientes...</p>';
    ultimoDocClientePaginado = null;
    clientesPaginadosCache = [];
  } else if (btnCargarMas) {
    btnCargarMas.disabled = true;
    btnCargarMas.innerHTML = '<i class="ri-loader-4-line"></i> Cargando...';
  }

  try {
    const mapaPrecios = await obtenerMapaPreciosZonas();

    // Consulta con límite y cursor de paginación
    let qClientes = query(
      collection(db, 'usuarios'),
      limit(TAMANIO_PAGINA_CLIENTES)
    );

    if (cargarMas && ultimoDocClientePaginado) {
      const { startAfter } = await import("firebase/firestore");
      qClientes = query(
        collection(db, 'usuarios'),
        startAfter(ultimoDocClientePaginado),
        limit(TAMANIO_PAGINA_CLIENTES)
      );
    }

    const snap = await getDocs(qClientes);

    if (snap.empty && !cargarMas) {
      contenedor.innerHTML = '<p class="texto-suave">No hay clientes registrados.</p>';
      if (btnCargarMas) btnCargarMas.style.display = 'none';
      return;
    }

    snap.forEach((docSnap) => {
      if (docSnap.id !== 'admin') {
        clientesPaginadosCache.push({ id: docSnap.id, ...docSnap.data() });
      }
    });

    // Guardar referencia del último documento para el próximo bloque
    ultimoDocClientePaginado = snap.docs[snap.docs.length - 1] || null;

    // Mostrar u ocultar el botón según si quedan más registros
    if (btnCargarMas) {
      btnCargarMas.disabled = false;
      btnCargarMas.innerHTML = '<i class="ri-arrow-down-line"></i> Cargar más clientes';
      btnCargarMas.style.display = snap.docs.length >= TAMANIO_PAGINA_CLIENTES ? 'inline-flex' : 'none';
    }

    let html = `
      <div class="admin-table-scroll">
        <table class="tabla-cuentas-admin tabla-clientes-admin">
          <thead>
            <tr>
              <th>Cliente</th>
              <th>ID / Cel</th>
              <th>Zona</th>
              <th>Precio/balde</th>
              <th>Kilos</th>
              <th>Baldes</th>
              <th>Estado de cuenta</th>
            </tr>
          </thead>
          <tbody>
    `;

    clientesPaginadosCache.forEach((c) => {
      const saldo = Number(c.saldoPendiente || 0);
      const tieneDeuda = saldo > 0;
      const precioBalde = Number(mapaPrecios.get(claveZona(c.zona)) || 0);
      html += `
        <tr>
          <td><strong>${c.nombre || 'Sin Nombre'}</strong></td>
          <td>${c.id}</td>
          <td>${c.zona || 'General'}</td>
          <td>${precioBalde > 0 ? formatearMoneda(precioBalde) : '<span class="texto-advertencia-cuenta">Sin configurar</span>'}</td>
          <td>${Number(c.totalKilos || 0).toFixed(1)} kg</td>
          <td><i class="ri-archive-line"></i> ${c.baldesCompostados || 0}</td>
          <td>
            ${tieneDeuda
          ? `<span class="badge-cuenta badge-cuenta-pendiente">⚠️ ${formatearMoneda(saldo)} pendiente</span>`
          : '<span class="badge-cuenta badge-cuenta-ok">✓ Al día</span>'}
          </td>
        </tr>
      `;
    });

    html += '</tbody></table></div>';
    contenedor.innerHTML = html;

  } catch (error) {
    console.error('Error cargando clientes paginados:', error);
    contenedor.innerHTML = '<p class="admin-mensaje-error">Error al cargar la lista de clientes.</p>';
  }
}

// ==========================================================
// 9. ESTADO DE CUENTAS / COBRANZAS
// ==========================================================
async function cargarEstadoCuentas() {
  const tabla = document.getElementById('tablaEstadoCuentasBody');
  if (!tabla) return;

  tabla.innerHTML = '<tr><td colspan="4" class="texto-suave admin-estado-tabla">Cargando estado de cuentas...</td></tr>';

  try {
    const [usuariosSnap, zonasSnap, recoleccionesSnap] = await Promise.all([
      getDocs(collection(db, 'usuarios')),
      getDocs(collection(db, 'zonas')),
      getDocs(query(collection(db, 'recolecciones'), where('estadoPago', '==', 'pendiente')))
    ]);

    const preciosPorZona = new Map();
    zonasSnap.forEach(docSnap => {
      const zona = docSnap.data();
      preciosPorZona.set(claveZona(zona.nombre), Number(zona.precioBalde || 0));
    });

    const pendientesPorCliente = new Map();
    recoleccionesSnap.forEach(docSnap => {
      const r = { id: docSnap.id, ...docSnap.data() };
      if (!pendientesPorCliente.has(r.clienteId)) pendientesPorCliente.set(r.clienteId, []);
      pendientesPorCliente.get(r.clienteId).push(r);
    });

    const clientes = [];
    usuariosSnap.forEach(docSnap => {
      if (docSnap.id === 'admin') return;
      const c = { id: docSnap.id, ...docSnap.data() };
      const pendientes = (pendientesPorCliente.get(c.id) || []).sort(
        (a, b) => (b.fechaRetiro?.seconds || 0) - (a.fechaRetiro?.seconds || 0)
      );
      const saldoPorRetiros = pendientes.reduce((acc, r) => acc + Number(r.total || 0), 0);
      const saldoGuardado = Number(c.saldoPendiente || 0);

      const saldo = Math.max(saldoPorRetiros, saldoGuardado);
      const saldoSinDetalle = Math.max(0, saldoGuardado - saldoPorRetiros);

      clientes.push({
        ...c,
        precioBaldeActual: Number(preciosPorZona.get(claveZona(c.zona)) || 0),
        retirosPendientes: pendientes.length,
        baldesAdeudados: pendientes.reduce((acc, r) => acc + Number(r.cantidadBaldes || 0), 0),
        saldoPorRetiros,
        saldoGuardado,
        saldoSinDetalle,
        pendientesDetalle: pendientes,
        saldoCuenta: saldo
      });
    });

    datosEstadoCuentas = clientes;

    const conDeuda = clientes.filter(c => Number(c.saldoCuenta || 0) > 0);
    const alDia = clientes.length - conDeuda.length;
    const totalPendiente = conDeuda.reduce((acc, c) => acc + Number(c.saldoCuenta || 0), 0);

    const elTotalClientes = document.getElementById('cuentasTotalClientes');
    const elAlDia = document.getElementById('cuentasAlDia');
    const elPendientes = document.getElementById('cuentasPendientes');
    const elMonto = document.getElementById('cuentasMontoPendiente');
    if (elTotalClientes) elTotalClientes.textContent = clientes.length;
    if (elAlDia) elAlDia.textContent = alDia;
    if (elPendientes) elPendientes.textContent = conDeuda.length;
    if (elMonto) elMonto.textContent = formatearMoneda(totalPendiente);

    renderizarEstadoCuentasFiltrado();
  } catch (error) {
    console.error('Error cargando estado de cuentas:', error);
    tabla.innerHTML = '<tr><td colspan="4" class="admin-estado-error-tabla">No se pudo cargar el estado de cuentas.</td></tr>';
  }
}

function renderizarEstadoCuentasFiltrado() {
  const tbody = document.getElementById('tablaEstadoCuentasBody');
  if (!tbody) return;

  document.querySelectorAll('[data-filtro-cuenta]').forEach(btn => {
    btn.classList.toggle('activo', btn.dataset.filtroCuenta === filtroEstadoCuentas);
  });

  let lista = [...datosEstadoCuentas];
  if (filtroEstadoCuentas === 'pendientes') lista = lista.filter(c => Number(c.saldoCuenta || 0) > 0);
  if (filtroEstadoCuentas === 'aldia') lista = lista.filter(c => Number(c.saldoCuenta || 0) <= 0);

  lista.sort((a, b) => {
    const deudaDiff = Number(b.saldoCuenta || 0) - Number(a.saldoCuenta || 0);
    if (deudaDiff !== 0) return deudaDiff;
    return (a.nombre || '').localeCompare(b.nombre || '');
  });

  if (lista.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="texto-suave admin-estado-tabla">No hay clientes para este filtro.</td></tr>';
    return;
  }

  tbody.innerHTML = lista.map(c => {
    const saldo = Number(c.saldoCuenta || 0);
    const tieneDeuda = saldo > 0;
    const pendientes = Array.isArray(c.pendientesDetalle) ? c.pendientesDetalle : [];
    const diferencia = Number(c.saldoSinDetalle || 0);

    const detalleRetiros = pendientes.length
      ? pendientes.map(r => `
          <div class="item-detalle-cuenta-inline">
            <div class="detalle-cuenta-inline-info">
              <strong>${formatearFechaTimestamp(r.fechaRetiro)} · ${Number(r.cantidadBaldes || 0)} balde${Number(r.cantidadBaldes || 0) === 1 ? '' : 's'}</strong>
              <span>${formatearMoneda(r.precioUnitario || 0)} c/u</span>
            </div>
            <strong class="detalle-cuenta-inline-total">${formatearMoneda(r.total || 0)}</strong>
          </div>
        `).join('')
      : '<p class="texto-suave admin-sin-detalle">No hay retiros pendientes con detalle registrado.</p>';

    const avisoDiferencia = diferencia > 0
      ? `<div class="aviso-diferencia-saldo">
          <i class="ri-alert-line"></i>
          <span>Hay ${formatearMoneda(diferencia)} de saldo pendiente sin una recolección asociada. Puede corresponder a datos de prueba anteriores.</span>
        </div>`
      : '';

    return `
      <tr class="fila-cuenta-resumen ${tieneDeuda ? 'fila-cuenta-pendiente' : 'fila-cuenta-aldia'}">
        <td class="celda-cuenta-cliente" title="${c.nombre || 'Sin nombre'}">
          <strong>${c.nombre || 'Sin nombre'}</strong>
        </td>
        <td class="celda-cuenta-zona" title="${c.zona || 'General'}">${c.zona || 'General'}</td>
        <td class="celda-saldo-total-cuenta">${tieneDeuda
        ? `<span class="saldo-total-cuenta">${formatearMoneda(saldo)}</span>`
        : '<span class="badge-cuenta badge-cuenta-ok">Al día</span>'}</td>
        <td class="celda-cuenta-accion">
          <button type="button" class="btn-ver-cuenta" onclick="toggleDetalleCuentaInline('${c.id}', this)" aria-expanded="false">
            <i class="ri-arrow-down-s-line"></i> Ver más${tieneDeuda && c.retirosPendientes ? ` (${c.retirosPendientes})` : ''}
          </button>
        </td>
      </tr>
      <tr id="detalle-cuenta-${c.id}" class="fila-detalle-cuenta-inline" hidden>
        <td colspan="4" class="celda-cuenta-detalle-inline">
          <div class="cabecera-detalle-cuenta-inline">
            <span>Detalle de ${c.nombre || 'cliente'}</span>
            <strong>${tieneDeuda ? `Total: ${formatearMoneda(saldo)}` : 'Cuenta al día'}</strong>
          </div>

          <div class="resumen-detalle-cuenta-inline">
            <div><span>ID / Cel.</span><strong>${c.id}</strong></div>
            <div><span>Zona</span><strong>${c.zona || 'General'}</strong></div>
            <div><span>Precio actual/balde</span><strong>${Number(c.precioBaldeActual || 0) > 0 ? formatearMoneda(c.precioBaldeActual) : 'Sin configurar'}</strong></div>
            <div><span>Retiros pendientes</span><strong>${c.retirosPendientes || 0}</strong></div>
            <div><span>Baldes adeudados</span><strong>${c.baldesAdeudados || 0}</strong></div>
          </div>

          ${tieneDeuda ? detalleRetiros : '<p class="cuenta-al-dia-detalle"><i class="ri-checkbox-circle-line"></i> Este cliente no tiene saldo pendiente.</p>'}
          ${avisoDiferencia}
          ${tieneDeuda ? `<button type="button" class="btn-gestionar-cuenta-inline" onclick="abrirDetalleCuentaCliente('${c.id}')">
            <i class="ri-settings-3-line"></i> Gestionar pagos
          </button>` : ''}
        </td>
      </tr>
    `;
  }).join('');
}

window.toggleDetalleCuentaInline = function (clienteId, boton) {
  const detalle = document.getElementById(`detalle-cuenta-${clienteId}`);
  if (!detalle) return;

  const abrir = detalle.hasAttribute('hidden');
  if (abrir) detalle.removeAttribute('hidden');
  else detalle.setAttribute('hidden', '');

  if (boton) {
    boton.setAttribute('aria-expanded', abrir ? 'true' : 'false');
    const icono = boton.querySelector('i');
    if (icono) icono.className = abrir ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line';
  }
};

window.filtrarEstadoCuentas = function (filtro) {
  if (!['todos', 'pendientes', 'aldia'].includes(filtro)) return;
  filtroEstadoCuentas = filtro;
  renderizarEstadoCuentasFiltrado();
};

window.abrirDetalleCuentaCliente = async function (clienteId) {
  try {
    const clienteSnap = await getDoc(doc(db, 'usuarios', clienteId));
    if (!clienteSnap.exists()) {
      Swal.fire('Atención', 'El cliente ya no existe.', 'warning');
      return;
    }

    seleccionarCliente({ id: clienteSnap.id, ...clienteSnap.data() });

    const contenido = document.getElementById('acc-buscar');
    const header = contenido?.previousElementSibling;
    if (contenido) contenido.classList.add('abierto');
    if (header) header.classList.add('activo');
    contenido?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    console.error('Error abriendo detalle de cuenta:', error);
    Swal.fire('Error', 'No se pudo abrir el perfil del cliente.', 'error');
  }
};

// ==========================================================
// 10. EXPORTACIONES CSV COMPLETAS
// ==========================================================
window.descargarClientesCSV = async function () {
  try {
    const [usuariosSnap, preciosPorZona] = await Promise.all([
      getDocs(collection(db, 'usuarios')),
      obtenerMapaPreciosZonas()
    ]);

    const clientes = [];
    usuariosSnap.forEach((docSnap) => {
      if (docSnap.id !== 'admin') clientes.push({ id: docSnap.id, ...docSnap.data() });
    });

    if (clientes.length === 0) {
      Swal.fire('Atención', 'No hay clientes registrados para descargar.', 'warning');
      return;
    }

    clientes.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));

    let csvContent = '\uFEFF';
    csvContent += 'Nombre;ID / Celular Principal;Celular Secundario;Zona;Precio por balde ($);Dirección;Fecha Inicio Servicio;Kilos Acumulados;Baldes Compostados;Saldo Pendiente ($);Estado de cuenta\r\n';

    clientes.forEach(c => {
      const secundario = (c.celularesAsociados && c.celularesAsociados.length > 1) ? c.celularesAsociados[1] : '';
      const saldo = Number(c.saldoPendiente || 0);
      const precioBalde = Number(preciosPorZona.get(claveZona(c.zona)) || 0);
      const estadoCuenta = saldo > 0 ? 'Pendiente' : 'Al día';

      csvContent += `"${escaparCSV(c.nombre || 'Sin nombre')}";"${escaparCSV(c.id)}";"${escaparCSV(secundario)}";"${escaparCSV(c.zona || 'General')}";"${precioBalde}";"${escaparCSV(c.direccion || 'Sin especificar')}";"${escaparCSV(formatearFechaVista(c.fechaInicioServicio))}";"${Number(c.totalKilos || 0).toFixed(1)}";"${Number(c.baldesCompostados || 0)}";"${saldo}";"${estadoCuenta}"\r\n`;
    });

    descargarArchivoCSV(csvContent, `clientes_registrados_${new Date().toISOString().slice(0, 10)}.csv`);
  } catch (error) {
    console.error('Error al exportar la lista de clientes:', error);
    Swal.fire('Error', 'No se pudo generar la descarga de clientes.', 'error');
  }
};

window.descargarSaldosPendientesCSV = async function () {
  try {
    const [usuariosSnap, recoleccionesSnap] = await Promise.all([
      getDocs(collection(db, 'usuarios')),
      getDocs(query(collection(db, 'recolecciones'), where('estadoPago', '==', 'pendiente')))
    ]);

    const clientesPorId = new Map();
    usuariosSnap.forEach(docSnap => {
      if (docSnap.id !== 'admin') clientesPorId.set(docSnap.id, { id: docSnap.id, ...docSnap.data() });
    });

    const pendientes = [];
    recoleccionesSnap.forEach(docSnap => {
      const r = { id: docSnap.id, ...docSnap.data() };
      pendientes.push(r);
    });

    if (pendientes.length === 0) {
      Swal.fire('Cuenta al día', 'No hay recolecciones pendientes para exportar.', 'success');
      return;
    }

    const saldoPorCliente = new Map();
    pendientes.forEach(r => {
      saldoPorCliente.set(r.clienteId, Number(saldoPorCliente.get(r.clienteId) || 0) + Number(r.total || 0));
    });

    pendientes.sort((a, b) => {
      const clienteA = clientesPorId.get(a.clienteId)?.nombre || a.clienteNombre || '';
      const clienteB = clientesPorId.get(b.clienteId)?.nombre || b.clienteNombre || '';
      const nombreDiff = clienteA.localeCompare(clienteB);
      if (nombreDiff !== 0) return nombreDiff;
      return Number(a.fechaRetiro?.seconds || 0) - Number(b.fechaRetiro?.seconds || 0);
    });

    let csvContent = '\uFEFF';
    csvContent += 'Cliente;Celular;Zona;Fecha retiro;Baldes adeudados;Precio por balde ($);Total retiro ($);Saldo total cliente ($);Estado\r\n';

    pendientes.forEach(r => {
      const cliente = clientesPorId.get(r.clienteId) || {};
      const nombre = cliente.nombre || r.clienteNombre || 'Sin nombre';
      const zona = r.zona || cliente.zona || 'General';
      const saldoTotal = Number(saldoPorCliente.get(r.clienteId) || 0);

      csvContent += `"${escaparCSV(nombre)}";"${escaparCSV(r.clienteId || '')}";"${escaparCSV(zona)}";"${escaparCSV(formatearFechaTimestamp(r.fechaRetiro))}";"${Number(r.cantidadBaldes || 0)}";"${Number(r.precioUnitario || 0)}";"${Number(r.total || 0)}";"${saldoTotal}";"Pendiente"\r\n`;
    });

    descargarArchivoCSV(csvContent, `saldos_pendientes_${new Date().toISOString().slice(0, 10)}.csv`);
  } catch (error) {
    console.error('Error exportando saldos pendientes:', error);
    Swal.fire('Error', 'No se pudo generar el CSV de saldos pendientes.', 'error');
  }
};

// ==========================================================
// 11. GENERADOR DE STORY DE IMPACTO INDIVIDUAL (ADMIN)
// ==========================================================
async function descargarStoryClienteSeleccionado() {
  const clienteId = document.getElementById('clienteSeleccionadoId')?.value;
  if (!clienteId) {
    Swal.fire('Atención', 'Primero seleccioná un cliente en el buscador.', 'warning');
    return;
  }

  const btn = document.getElementById('btnDescargarStoryAdmin');
  const storyElem = document.getElementById('plantillaStoryAdmin');
  const anioSeleccionado = document.getElementById('selectAnioStoryAdmin')?.value || 'historico';
  if (!storyElem) return;

  try {
    const docSnap = await getDoc(doc(db, "usuarios", clienteId));
    if (!docSnap.exists()) {
      Swal.fire('Error', 'No se encontraron los datos del cliente.', 'error');
      return;
    }

    const c = docSnap.data();
    const primerNombre = (c.nombre || "Vecino/a").trim().split(" ")[0];

    let diasCompostando = 0;
    if (c.fechaInicioServicio) {
      const fechaIni = new Date(c.fechaInicioServicio + "T00:00:00");
      const hoy = new Date();
      diasCompostando = Math.max(0, Math.floor((hoy - fechaIni) / (1000 * 60 * 60 * 24)));
    }

    let kilosMostrar = 0;
    let baldesMostrar = 0;

    if (anioSeleccionado === 'historico') {
      kilosMostrar = Number(c.totalKilos || 0);
      baldesMostrar = c.baldesCompostados ?? c.totalBaldes ?? 0;
      const elAnio = document.getElementById('storyAdminAnioTexto');
      if (elAnio) elAnio.innerText = "histórico";
    } else {
      const qHistorial = query(
        collection(db, "historial_impacto"),
        where("clienteId", "==", clienteId),
        where("anio", "==", anioSeleccionado)
      );
      const histSnap = await getDocs(qHistorial);
      histSnap.forEach(d => {
        kilosMostrar += Number(d.data().kilos || 0);
        baldesMostrar += Number(d.data().baldes || 0);
      });
      const elAnio = document.getElementById('storyAdminAnioTexto');
      if (elAnio) elAnio.innerText = "del " + anioSeleccionado;
    }

    const compostMostrar = Math.round(kilosMostrar / 3);

    document.getElementById('storyAdminNombre').innerText = primerNombre;
    document.getElementById('storyAdminDias').innerText = `${diasCompostando} días`;
    document.getElementById('storyAdminBaldes').innerText = `${baldesMostrar} baldes`;
    document.getElementById('storyAdminKilos').innerText = `${kilosMostrar.toFixed(0)} kg de orgánicos`;
    document.getElementById('storyAdminCompost').innerText = `${compostMostrar} kg de compost`;

    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="ri-loader-4-line"></i> Generando...';
    }

    // 🟢 Importación dinámica de html2canvas justo en el momento del click
    const html2canvasModule = await import('html2canvas');
    const html2canvas = html2canvasModule.default;

    const canvas = await html2canvas(storyElem, {
      scale: 1,
      useCORS: true,
      allowTaint: true,
      logging: false,
      windowWidth: 1080,
      windowHeight: 1920
    });

    const enlace = document.createElement('a');
    const sufijoArchivo = anioSeleccionado === 'historico' ? 'total' : anioSeleccionado;
    enlace.download = `impacto_${primerNombre.toLowerCase()}_${sufijoArchivo}.png`;
    enlace.href = canvas.toDataURL('image/png');
    enlace.click();

    Swal.fire({
      icon: 'success',
      title: '¡Story generada!',
      text: `Se descargó el resumen de ${primerNombre} listo para enviar por WhatsApp.`,
      confirmButtonColor: '#16a34a'
    });

  } catch (error) {
    console.error('Error generando story desde admin:', error);
    Swal.fire('Error', 'No se pudo generar la imagen.', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="ri-download-2-line"></i> Descargar Imagen';
    }
  }
}

// ==========================================================
// 12. GENERADOR DE STORY GLOBAL (TODA LA COMUNIDAD POR AÑO)
// ==========================================================
async function descargarStoryGlobal() {
  const btn = document.getElementById('btnDescargarStoryGlobal');
  const storyElem = document.getElementById('plantillaStoryGlobal');
  const anioSeleccionado = document.getElementById('selectAnioStoryGlobal')?.value || 'historico';
  if (!storyElem) return;

  try {
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="ri-loader-4-line"></i> Generando...';
    }

    let sumaKilos = 0;
    let sumaBaldes = 0;
    let familiasActivas = 0;

    if (anioSeleccionado === 'historico') {
      const querySnapshot = await getDocs(collection(db, "usuarios"));
      querySnapshot.forEach((docSnap) => {
        const data = docSnap.data();
        if (docSnap.id !== "admin") {
          familiasActivas++;
          sumaKilos += Number(data.totalKilos || 0);
          sumaBaldes += Number(data.baldesCompostados || data.totalBaldes || 0);
        }
      });
      const elAnio = document.getElementById('storyGlobalAnioTexto');
      if (elAnio) elAnio.innerText = "hasta hoy";
    } else {
      const qHistorial = query(
        collection(db, "historial_impacto"),
        where("anio", "==", anioSeleccionado)
      );
      const histSnap = await getDocs(qHistorial);
      const clientesUnicos = new Set();

      histSnap.forEach((docSnap) => {
        const d = docSnap.data();
        sumaKilos += Number(d.kilos || 0);
        sumaBaldes += Number(d.baldes || 0);
        if (d.clienteId) clientesUnicos.add(d.clienteId);
      });

      familiasActivas = clientesUnicos.size;
      const elAnio = document.getElementById('storyGlobalAnioTexto');
      if (elAnio) elAnio.innerText = "en el " + anioSeleccionado;
    }

    const compostGenerado = Math.round(sumaKilos / 3);

    document.getElementById('storyGlobalFamilias').innerText = familiasActivas;
    document.getElementById('storyGlobalKilos').innerText = `${Math.round(sumaKilos)} kg`;
    document.getElementById('storyGlobalBaldes').innerText = sumaBaldes;
    document.getElementById('storyGlobalCompost').innerText = `${compostGenerado} kg`;

    // 🟢 Importación dinámica de html2canvas para la Story Global
    const html2canvasModule = await import('html2canvas');
    const html2canvas = html2canvasModule.default;

    const canvas = await html2canvas(storyElem, {
      scale: 1,
      useCORS: true,
      allowTaint: true,
      logging: false,
      windowWidth: 1080,
      windowHeight: 1920
    });

    const enlace = document.createElement('a');
    const sufijo = anioSeleccionado === 'historico' ? 'total' : anioSeleccionado;
    enlace.download = `impacto_global_zdc_${sufijo}.png`;
    enlace.href = canvas.toDataURL('image/png');
    enlace.click();

    Swal.fire({
      icon: 'success',
      title: '¡Story Global generada!',
      text: `Se descargó la imagen del impacto comunitario (${anioSeleccionado}) lista para compartir.`,
      confirmButtonColor: '#16a34a'
    });

  } catch (error) {
    console.error('Error generando story global:', error);
    Swal.fire('Error', 'No se pudo generar la imagen global.', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="ri-instagram-line"></i> Story Global';
    }
  }
}

// ==========================================================
// 13. INICIALIZACIÓN UNIFICADA DE PÁGINA TRAS AUTENTICARSE
// ==========================================================
async function inicializarPanelAdmin() {
  cargarConfiguracionHorarioAdmin();
  renderizarListaZonas();
  cargarSelectsDeZonas();
  await cargarClientesIniciales();
  inicializarBuscadorClientes();
  cargarTurnosAdmin();
  cargarPedidosAdmin();
  renderizarListaCompletaClientes();
  cargarEstadoCuentas();
}

window.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btnDescargarCSV')?.addEventListener('click', window.descargarHojaDeRutaCSV);
  document.getElementById('btnDescargarClientesCSV')?.addEventListener('click', window.descargarClientesCSV);
  document.getElementById('btnDescargarSaldosCSV')?.addEventListener('click', window.descargarSaldosPendientesCSV);
  document.getElementById('btnDescargarStoryAdmin')?.addEventListener('click', descargarStoryClienteSeleccionado);
  document.getElementById('btnDescargarStoryGlobal')?.addEventListener('click', descargarStoryGlobal);

  document.getElementById('btnRefrescarClientes')?.addEventListener('click', async () => {
    await cargarClientesIniciales();
    renderizarListaCompletaClientes();
    cargarEstadoCuentas();
  });

  document.getElementById('btnRefrescarEstadoCuentas')?.addEventListener('click', () => {
    cargarEstadoCuentas();
  });

  document.getElementById('btnCargarMasClientes')?.addEventListener('click', () => {
    renderizarListaCompletaClientes(true);
  });
});