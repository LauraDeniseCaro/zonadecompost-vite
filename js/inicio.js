// js/inicio.js - Lógica principal de Zona de Compost

import {
  doc,
  getDoc,
  getDocs,
  collection,
  query,
  where,
  limit,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { db } from "./firebase-config.js";

// Guardamos el cliente en memoria tras el login
let clienteLogueado = null;

// ==========================================================
// A. FUNCIONES DEL MODAL DE LOGIN Y CONTADOR GLOBAL
// ==========================================================

window.abrirModalLogin = function () {
  const modal = document.getElementById("modalLogin");
  if (modal) modal.style.display = "flex";
};

window.cerrarModalLogin = function () {
  const modal = document.getElementById("modalLogin");
  if (modal) modal.style.display = "none";
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

// 🟢 VERSIÓN OPTIMIZADA: Solo hace 1 lectura a la base de datos en vez de traer a todos los usuarios
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
// B. LÓGICA DE LOGIN DEL CLIENTE (Redirección a cliente.html)
// ==========================================================
window.loginUsuario = async function (e) {
  if (e && e.preventDefault) e.preventDefault();

  const input = document.getElementById("celuUsuario");
  const valorIngresado = input ? input.value.trim() : "";

  if (!valorIngresado) {
    alert("Por favor, ingresá tu celular o contraseña.");
    return;
  }

  try {
    // 1. Verificación de Contraseña Administrador
    const adminRef = doc(db, "usuarios", "admin");
    const adminSnap = await getDoc(adminRef);

    if (adminSnap.exists() && valorIngresado === adminSnap.data().clave) {
      localStorage.setItem("esAdmin", "true");
      window.cerrarModalLogin();
      window.location.href = "admin.html";
      return;
    }

    // 2. Búsqueda por Celular Principal
    const docRef = doc(db, "usuarios", valorIngresado);
    const docSnap = await getDoc(docRef);

    if (docSnap.exists() && valorIngresado !== "admin") {
      clienteLogueado = { id: docSnap.id, ...docSnap.data() };
      localStorage.setItem("usuarioCelu", docSnap.id);
      localStorage.removeItem("esAdmin");

      window.cerrarModalLogin();
      window.location.href = "cliente.html";
      return;
    }

    // 3. Búsqueda por Celular Secundario
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
        localStorage.removeItem("esAdmin");

        window.cerrarModalLogin();
        window.location.href = "cliente.html";
        return;
      }
    } catch (eConsulta) {
      console.warn("Fallo en la consulta array-contains...", eConsulta);
    }

    // 4. PLAN B (Fallback): Escaneo manual
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
      localStorage.removeItem("esAdmin");

      window.cerrarModalLogin();
      window.location.href = "cliente.html";
      return;
    }

    alert("El número de celular o contraseña no son válidos.");
  } catch (error) {
    console.error("Error detallado en login:", error);
    alert("Hubo un inconveniente al conectar con el servidor: " + error.message);
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