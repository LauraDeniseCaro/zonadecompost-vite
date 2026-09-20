// js/inicio.js - Lógica principal de Zona de Compost

import {
  doc,
  getDoc,
  getDocs,
  collection,
  query,
  where,
  limit
} from "firebase/firestore";
import { auth, db } from "./firebase-config.js";
import { signInWithEmailAndPassword } from "firebase/auth";
import Swal from "sweetalert2";

// Configuración global de alert con SweetAlert2
window.alert = function (mensaje) {
  Swal.fire({
    text: mensaje,
    confirmButtonColor: '#16a34a',
    confirmButtonText: 'Entendido'
  });
};

// Guardamos el cliente en memoria tras el login
let clienteLogueado = null;

// ==========================================================
// A. FUNCIONES DEL MODAL DE LOGIN Y CONTADOR GLOBAL
// ==========================================================

window.abrirModalLogin = function () {
  const modal = document.getElementById("modalLogin");
  if (modal) {
    modal.classList.remove("modal-oculto");
    modal.style.display = "flex";
    const input = document.getElementById("celuUsuario");
    if (input) input.focus();
  }
};

window.cerrarModalLogin = function () {
  const modal = document.getElementById("modalLogin");
  if (modal) {
    modal.classList.add("modal-oculto");
    modal.style.display = "none";
  }
};

// Función auxiliar para el efecto de conteo desde cero
function animarNumero(idElemento, valorFinal, decimales = 0, sufijo = "") {
  const elemento = document.getElementById(idElemento);
  if (!elemento) return;

  const duracion = 1500; // Tiempo total de animación en ms (1.5 segundos)
  const pasos = 40;
  const incremento = valorFinal / pasos;
  const tiempoPaso = duracion / pasos;
  let valorActual = 0;

  const timer = setInterval(() => {
    valorActual += incremento;
    if (valorActual >= valorFinal) {
      valorActual = valorFinal;
      clearInterval(timer);
    }
    const textoFormateado =
      decimales > 0 ? valorActual.toFixed(decimales) : Math.round(valorActual);
    elemento.innerText = `${textoFormateado}${sufijo}`;
  }, tiempoPaso);
}

// Carga optimizada de estadísticas globales
async function cargarImpactoGlobal() {
  try {
    const docRef = doc(db, "estadisticas", "globales");
    const docSnap = await getDoc(docRef);

    let sumaKilos = 0;
    let clientesActivos = 0;

    if (docSnap.exists()) {
      const data = docSnap.data();
      sumaKilos = Number(data.totalKilos || 0);
      clientesActivos = Number(data.totalFamilias || 0);
    } else {
      // Fallback de seguridad temporal
      const querySnapshot = await getDocs(collection(db, "usuarios"));
      querySnapshot.forEach((d) => {
        if (d.id !== "admin") {
          clientesActivos++;
          if (d.data().totalKilos) sumaKilos += Number(d.data().totalKilos);
        }
      });
    }

    // Animación exclusiva de Kilos y Familias
    animarNumero("contadorKilos", sumaKilos, 1);
    animarNumero("contadorClientes", clientesActivos, 0);

  } catch (error) {
    console.error("Error al obtener el impacto comunitario:", error);
  }
}

// ==========================================================
// B. LÓGICA DE LOGIN (CLIENTE POR CELULAR / ADMIN POR FIREBASE AUTH)
// ==========================================================
window.loginUsuario = async function (e) {
  if (e && e.preventDefault) e.preventDefault();

  const botonSubmit = e?.submitter || document.querySelector("#formLogin button[type='submit']");
  if (botonSubmit) {
    botonSubmit.disabled = true;
    botonSubmit.dataset.textoOriginal = botonSubmit.innerHTML;
    botonSubmit.innerHTML = '<i class="ri-loader-4-line icon-spin"></i> Ingresando...';
  }

  const input = document.getElementById("celuUsuario");
  const valorIngresado = input ? input.value.trim() : "";

  if (!valorIngresado) {
    alert("Por favor, ingresá tu celular o usuario.");
    if (botonSubmit) {
      botonSubmit.disabled = false;
      botonSubmit.innerHTML = botonSubmit.dataset.textoOriginal || 'Ingresar';
    }
    return;
  }

  try {
    // --------------------------------------------------------
    // 1. INGRESO DE ADMINISTRADOR (FIREBASE AUTH)
    // Si escribe "admin", su email o detecta el acceso del panel
    // --------------------------------------------------------
    if (valorIngresado.toLowerCase() === "admin" || valorIngresado.includes("@")) {
      window.cerrarModalLogin();

      const { value: formValores } = await Swal.fire({
        title: 'Acceso Administrador',
        html: `
          <input id="swalAdminEmail" type="email" class="swal2-input" placeholder="Correo electrónico" value="${valorIngresado.includes('@') ? valorIngresado : ''}">
          <input id="swalAdminPass" type="password" class="swal2-input" placeholder="Contraseña">
        `,
        focusConfirm: false,
        showCancelButton: true,
        confirmButtonText: 'Ingresar',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: '#16a34a',
        cancelButtonColor: '#64748b',
        preConfirm: () => {
          const email = document.getElementById('swalAdminEmail').value.trim();
          const pass = document.getElementById('swalAdminPass').value;
          if (!email || !pass) {
            Swal.showValidationMessage('Completá el correo y la contraseña');
            return false;
          }
          return { email, pass };
        }
      });

      if (!formValores) {
        if (botonSubmit) {
          botonSubmit.disabled = false;
          botonSubmit.innerHTML = botonSubmit.dataset.textoOriginal || 'Ingresar';
        }
        return;
      }

      // Autenticación formal en los servidores de Firebase
      await signInWithEmailAndPassword(auth, formValores.email, formValores.pass);

      localStorage.removeItem("usuarioCelu");
      window.location.href = "/admin.html";
      return;
    }

    // --------------------------------------------------------
    // 2. INGRESO DE CLIENTE: Búsqueda por Celular Principal (6 dígitos)
    // --------------------------------------------------------
    const docRef = doc(db, "usuarios", valorIngresado);
    const docSnap = await getDoc(docRef);

    if (docSnap.exists() && valorIngresado !== "admin") {
      clienteLogueado = { id: docSnap.id, ...docSnap.data() };
      localStorage.setItem("usuarioCelu", docSnap.id);

      window.cerrarModalLogin();
      window.location.href = "/cliente.html";
      return;
    }

    // --------------------------------------------------------
    // 3. INGRESO DE CLIENTE: Búsqueda por Celular Secundario
    // --------------------------------------------------------
    try {
      const qSecundario = query(
        collection(db, "usuarios"),
        where("celularesAsociados", "array-contains", valorIngresado),
        limit(1)
      );

      const querySnapshot = await getDocs(qSecundario);

      if (!querySnapshot.empty) {
        const clienteDoc = querySnapshot.docs[0];
        clienteLogueado = { id: clienteDoc.id, ...clienteDoc.data() };

        localStorage.setItem("usuarioCelu", clienteDoc.id);

        window.cerrarModalLogin();
        window.location.href = "/cliente.html";
        return;
      }
    } catch (eConsulta) {
      console.warn("Fallo en la consulta array-contains...", eConsulta);
    }

    // --------------------------------------------------------
    // 4. PLAN B (Fallback): Escaneo manual de clientes
    // --------------------------------------------------------
    const todosSnapshot = await getDocs(collection(db, "usuarios"));
    let usuarioEncontrado = null;

    todosSnapshot.forEach((docSnap) => {
      if (docSnap.id === "admin") return;
      const data = docSnap.data();

      if (Array.isArray(data.celularesAsociados) && data.celularesAsociados.includes(valorIngresado)) {
        usuarioEncontrado = { id: docSnap.id, ...data };
      }
    });

    if (usuarioEncontrado) {
      clienteLogueado = usuarioEncontrado;
      localStorage.setItem("usuarioCelu", usuarioEncontrado.id);

      window.cerrarModalLogin();
      window.location.href = "/cliente.html";
      return;
    }

    alert("El número de celular ingresado no figura registrado.");
  } catch (error) {
    console.error("Error detallado en login:", error);
    if (error.code === 'auth/invalid-credential' || error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password') {
      alert("Credenciales de administrador incorrectas.");
    } else {
      alert("Hubo un inconveniente al conectar con el servidor: " + error.message);
    }
  } finally {
    if (botonSubmit) {
      botonSubmit.disabled = false;
      botonSubmit.innerHTML = botonSubmit.dataset.textoOriginal || 'Ingresar';
    }
  }
};

// ==========================================================
// C. CONSULTAR PRECIO / ENCARGAR PRODUCTO VÍA WHATSAPP
// ==========================================================
window.encargarProducto = function (nombreProducto) {
  const mensaje = encodeURIComponent(
    `¡Hola Zona de Compost! 🌱 Quería consultar el precio actual y más detalles sobre: ${nombreProducto}.`
  );
  window.open(`https://wa.me/5492944517496?text=${mensaje}`, "_blank");
};

// ==========================================================
// D. LÓGICA DEL CARRUSEL / SLIDER DE IMÁGENES
// ==========================================================
const carruselesEstado = {};

function inicializarCarruseles() {
  const contenedores = document.querySelectorAll(".carrusel-container");

  contenedores.forEach((container) => {
    const id = container.id;
    const slides = container.querySelectorAll(".slide");
    const dotsContainer = container.querySelector(".carrusel-dots");

    if (!slides.length) return;

    carruselesEstado[id] = { index: 0, total: slides.length };
    dotsContainer.innerHTML = "";

    slides.forEach((_, idx) => {
      const dot = document.createElement("span");
      dot.classList.add("dot");
      if (idx === 0) dot.classList.add("active");
      dot.onclick = () => irASlide(id, idx);
      dotsContainer.appendChild(dot);
    });

    setInterval(() => { moverCarrusel(id, 1); }, 4000);
  });
}

window.moverCarrusel = function (carruselId, direccion) {
  const estado = carruselesEstado[carruselId];
  if (!estado) return;

  let nuevoIndex = estado.index + direccion;
  if (nuevoIndex >= estado.total) nuevoIndex = 0;
  if (nuevoIndex < 0) nuevoIndex = estado.total - 1;

  irASlide(carruselId, nuevoIndex);
};

function irASlide(carruselId, nuevoIndex) {
  const container = document.getElementById(carruselId);
  if (!container) return;

  const slides = container.querySelectorAll(".slide");
  const dots = container.querySelectorAll(".dot");

  slides.forEach((slide, i) => { slide.classList.toggle("active", i === nuevoIndex); });
  dots.forEach((dot, i) => { dot.classList.toggle("active", i === nuevoIndex); });

  carruselesEstado[carruselId].index = nuevoIndex;
}

// ==========================================================
// E. INICIALIZACIÓN AL CARGAR LA PÁGINA
// ==========================================================
window.addEventListener("DOMContentLoaded", () => {
  cargarImpactoGlobal();
  inicializarCarruseles();

  const formLogin = document.getElementById("formLogin");
  if (formLogin) {
    formLogin.addEventListener("submit", window.loginUsuario);
  }
});