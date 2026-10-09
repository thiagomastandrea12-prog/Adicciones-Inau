// Lee únicamente la pestaña pública de estadísticas agregadas de Google Sheets.
// No consulta ni muestra la hoja que contiene las respuestas individuales.
const CSV_PUBLICO_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTZL3z-RhqI5mvCY7T61pSpGhSEm307zELNeYtx-zFdvMamnTwuJ1k7FLD0hXbFSa1Kn5yr-pZxruGr/pub?gid=2146131002&single=true&output=csv';
const INTERVALO_ACTUALIZACION_MS = 60_000; // consultar cada 60 segundos

const totalElement = document.getElementById("total-respuestas");
const cursosBody = document.getElementById("cursos-body");
const estadoElement = document.getElementById("estado-actualizacion");
const horaElement = document.getElementById("ultima-actualizacion");

function parseCSV(texto) {
    const filas = [];
    let fila = [];
    let campo = "";
    let entreComillas = false;

    for (let i = 0; i < texto.length; i++) {
        const caracter = texto[i];
        if (caracter === '"') {
            if (entreComillas && texto[i + 1] === '"') {
                campo += '"';
                i++;
            } else {
                entreComillas = !entreComillas;
            }
        } else if (caracter === "," && !entreComillas) {
            fila.push(campo);
            campo = "";
        } else if ((caracter === "\n" || caracter === "\r") && !entreComillas) {
            if (caracter === "\r" && texto[i + 1] === "\n") i++;
            fila.push(campo);
            if (fila.some(celda => celda.trim() !== "")) filas.push(fila);
            fila = [];
            campo = "";
        } else {
            campo += caracter;
        }
    }
    if (campo.length > 0 || fila.length > 0) {
        fila.push(campo);
        if (fila.some(celda => celda.trim() !== "")) filas.push(fila);
    }
    return filas;
}

function normalizar(texto) {
    return String(texto ?? "")
        .trim()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();
}

function numeroCelda(valor) {
    const digitos = String(valor ?? "").trim().replace(/[^0-9-]/g, "");
    if (!digitos || digitos === "-") return null;
    const numero = Number.parseInt(digitos, 10);
    return Number.isFinite(numero) ? numero : null;
}

function extraerEstadisticas(filas) {
    let total = null;
    const filaTotal = filas.find(fila => normalizar(fila[0]) === "total de respuestas");
    if (filaTotal) {
        for (let i = 1; i < filaTotal.length; i++) {
            const valor = numeroCelda(filaTotal[i]);
            if (valor !== null) { total = valor; break; }
        }
    }

    const indiceCabecera = filas.findIndex(fila =>
        fila.some(celda => normalizar(celda) === "curso") &&
        fila.some(celda => normalizar(celda) === "respuestas")
    );

    const cursos = [];
    if (indiceCabecera !== -1) {
        const cabecera = filas[indiceCabecera];
        const indiceCurso = cabecera.findIndex(celda => normalizar(celda) === "curso");
        const indiceRespuestas = cabecera.findIndex(celda => normalizar(celda) === "respuestas");
        for (let i = indiceCabecera + 1; i < filas.length; i++) {
            const nombreCurso = String(filas[i][indiceCurso] ?? "").trim();
            const cantidad = numeroCelda(filas[i][indiceRespuestas]);
            if (!nombreCurso || cantidad === null) continue;
            cursos.push({ curso: nombreCurso, respuestas: cantidad });
        }
    }

    if (total === null) total = cursos.reduce((suma, curso) => suma + curso.respuestas, 0);
    return { total, cursos };
}

function mostrarEstadisticas(estadisticas) {
    totalElement.textContent = String(estadisticas.total);
    cursosBody.replaceChildren();

    if (estadisticas.cursos.length === 0) {
        const fila = document.createElement("tr");
        const celda = document.createElement("td");
        celda.colSpan = 3;
        celda.className = "mensaje-tabla";
        celda.textContent = "Todavía no hay datos por curso para mostrar.";
        fila.appendChild(celda);
        cursosBody.appendChild(fila);
    } else {
        const totalParaPorcentaje = estadisticas.total || estadisticas.cursos.reduce((suma, curso) => suma + curso.respuestas, 0);
        for (const dato of estadisticas.cursos) {
            const fila = document.createElement("tr");
            const curso = document.createElement("th");
            curso.scope = "row";
            curso.textContent = dato.curso;
            const respuestas = document.createElement("td");
            respuestas.textContent = String(dato.respuestas);
            const porcentaje = document.createElement("td");
            const pct = totalParaPorcentaje > 0 ? (dato.respuestas / totalParaPorcentaje) * 100 : 0;
            porcentaje.textContent = `${pct.toLocaleString("es-UY", { maximumFractionDigits: 1 })}%`;
            fila.append(curso, respuestas, porcentaje);
            cursosBody.appendChild(fila);
        }
    }

    const actualizado = new Date();
    horaElement.textContent = `Última consulta: ${actualizado.toLocaleTimeString("es-UY", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
    estadoElement.textContent = "Estadísticas cargadas.";
    estadoElement.classList.remove("estado-error");
}

async function actualizarEstadisticas() {
    try {
        const url = new URL(CSV_PUBLICO_URL);
        url.searchParams.set("_refresh", String(Date.now())); // evita caché del navegador
        const respuesta = await fetch(url.toString(), { cache: "no-store" });
        if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);
        const csv = await respuesta.text();
        if (!csv.trim() || /<html/i.test(csv.slice(0, 100))) throw new Error("Google no devolvió el CSV publicado.");
        const estadisticas = extraerEstadisticas(parseCSV(csv));
        mostrarEstadisticas(estadisticas);
    } catch (error) {
        console.error("No se pudieron cargar las estadísticas:", error);
        estadoElement.textContent = "No se pudieron actualizar los datos. Se volverá a intentar automáticamente.";
        estadoElement.classList.add("estado-error");
        if (totalElement.textContent === "—") {
            cursosBody.replaceChildren();
            const fila = document.createElement("tr");
            const celda = document.createElement("td");
            celda.colSpan = 3;
            celda.className = "mensaje-tabla";
            celda.textContent = "No se pudieron cargar los resultados. Comprobá tu conexión o la publicación de Google Sheets.";
            fila.appendChild(celda);
            cursosBody.appendChild(fila);
        }
    }
}

actualizarEstadisticas();
window.setInterval(actualizarEstadisticas, INTERVALO_ACTUALIZACION_MS);
