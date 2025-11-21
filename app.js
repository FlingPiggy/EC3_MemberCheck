let SECTIONS = {};   // will be filled from sections.json
    let SECTION_LIST = []; // original array

    const BUCKLING_CURVES = {
      a0: 0.13,
      a: 0.21,
      b: 0.34,
      c: 0.49,
      d: 0.76
    };

    const E = 210000; // MPa = N/mm²
    const POISSON = 0.3;
    const G = 81000; // MPa
    const gammaM0 = 1.0;
    const gammaM1 = 1.0;
    const C1_LTB = 1.0; // given assumption for moment gradient factor

    const STEEL_GRADE_DATA = {
      S235: {
        label: "S235",
        nominalFy: 235,
        reductions: [
          { limit: 16, fy: 235 },
          { limit: 40, fy: 225 },
          { limit: 63, fy: 215 },
          { limit: 80, fy: 205 },
          { limit: 100, fy: 195 },
          { limit: 150, fy: 185 },
          { limit: 200, fy: 175 },
          { limit: Infinity, fy: 165 }
        ]
      },
      S275: {
        label: "S275",
        nominalFy: 275,
        reductions: [
          { limit: 16, fy: 275 },
          { limit: 40, fy: 265 },
          { limit: 63, fy: 255 },
          { limit: 80, fy: 245 },
          { limit: 100, fy: 235 },
          { limit: 150, fy: 225 },
          { limit: 200, fy: 215 },
          { limit: Infinity, fy: 195 }
        ]
      },
      S355: {
        label: "S355",
        nominalFy: 355,
        reductions: [
          { limit: 16, fy: 355 },
          { limit: 40, fy: 345 },
          { limit: 63, fy: 335 },
          { limit: 80, fy: 325 },
          { limit: 100, fy: 315 },
          { limit: 150, fy: 295 },
          { limit: 200, fy: 285 },
          { limit: Infinity, fy: 275 }
        ]
      }
    };

    const UTILIZATION_CLASSES = ["util-ok", "util-high", "util-ng"];

    // ---- Load JSON & init ----
    async function loadSectionsFromJSON() {
      try {
        const resp = await fetch("sections.json");
        if (!resp.ok) throw new Error("HTTP " + resp.status);
        const data = await resp.json();
        SECTION_LIST = data;

        // build map by name
        SECTIONS = {};
        data.forEach(sec => {
          SECTIONS[sec.name] = {
            name: sec.name,
            type: sec.type || "UB",
            h: sec.h_mm,
            b: sec.b_mm,
            tw: sec.tw_mm,
            tf: sec.tf_mm,
            r: sec.r_mm || 0,
            A: sec.A_mm2,
            Iy: sec.Iy_mm4,
            Iz: sec.Iz_mm4,
            Wpl_y: sec.Wpl_y_mm3,
            Wpl_z: sec.Wpl_z_mm3,
            Wel_y: sec.Wel_y_mm3,
            Wel_z: sec.Wel_z_mm3,
            Av_y: sec.Av_y_mm2,
            Av_z: sec.Av_z_mm2
          };
        });

        populateSectionSelect();
        updateSectionInfo();
      } catch (e) {
        const sel = document.getElementById("section-select");
        sel.innerHTML = "";
        const opt = document.createElement("option");
        opt.textContent = "Error loading sections.json";
        opt.value = "";
        sel.appendChild(opt);
        document.getElementById("results").textContent =
          "Could not load sections.json. Please ensure it is in the same folder and you are using a local web server.\nError: " + e;
        setGoverningChipMessage("Unable to load sections.json.");
      }
    }

    function populateSectionSelect() {
      const select = document.getElementById("section-select");
      select.innerHTML = "";

      const ubGroup = document.createElement("optgroup");
      ubGroup.label = "Universal Beams (UB)";
      const ucGroup = document.createElement("optgroup");
      ucGroup.label = "Universal Columns (UC)";

      Object.values(SECTIONS).forEach(sec => {
        const opt = document.createElement("option");
        opt.value = sec.name;
        opt.textContent = sec.name;
        if (sec.type === "UB") ubGroup.appendChild(opt);
        else ucGroup.appendChild(opt);
      });

      if (ubGroup.children.length) select.appendChild(ubGroup);
      if (ucGroup.children.length) select.appendChild(ucGroup);

      // default first section
      if (Object.keys(SECTIONS).length > 0) {
        select.value = Object.keys(SECTIONS)[0];
      }
    }

    function getMaxPlateThickness(sec) {
      return Math.max(sec.tw, sec.tf);
    }

    function getGradeRangeForThickness(grade, thickness) {
      if (!grade || thickness == null) return null;
      const entries = grade.reductions;
      let selected = entries[entries.length - 1];
      let idx = entries.length - 1;
      for (let i = 0; i < entries.length; i++) {
        if (thickness <= entries[i].limit) {
          selected = entries[i];
          idx = i;
          break;
        }
      }
      const prevLimit = idx === 0 ? 0 : entries[idx - 1].limit;
      let rangeText;
      if (!isFinite(selected.limit)) {
        rangeText = `t > ${prevLimit} mm`;
      } else if (idx === 0) {
        rangeText = `t ≤ ${selected.limit} mm`;
      } else {
        rangeText = `${prevLimit} < t ≤ ${selected.limit} mm`;
      }
      return {
        fy: selected.fy,
        rangeText
      };
    }

    function resolveFyForSection(sec, gradeKey) {
      const grade = STEEL_GRADE_DATA[gradeKey];
      const fallbackFy = grade
        ? grade.nominalFy
        : parseFloat(String(gradeKey || "").replace(/[^\d.]/g, "")) || 0;
      const thickness = sec ? getMaxPlateThickness(sec) : null;
      if (!grade || thickness == null) {
        return {
          fy: fallbackFy,
          gradeLabel: grade ? grade.label : (gradeKey || "fy"),
          nominalFy: grade ? grade.nominalFy : fallbackFy,
          thickness,
          rangeText: ""
        };
      }
      const reduction = getGradeRangeForThickness(grade, thickness);
      return {
        fy: reduction ? reduction.fy : fallbackFy,
        gradeLabel: grade.label,
        nominalFy: grade.nominalFy,
        thickness,
        rangeText: reduction ? reduction.rangeText : ""
      };
    }

    function updateFyInfo() {
      const fyNote = document.getElementById("fy-note");
      if (!fyNote) return;
      const sectionName = document.getElementById("section-select").value;
      const sec = SECTIONS[sectionName];
      const gradeKey = document.getElementById("steel-grade").value;
      const grade = STEEL_GRADE_DATA[gradeKey];
      if (!grade) {
        fyNote.textContent = "Select a steel grade to see thickness-dependent fy.";
        return;
      }
      if (!sec) {
        fyNote.textContent = `${grade.label}: select a section to evaluate thickness reductions.`;
        return;
      }
      const fyInfo = resolveFyForSection(sec, gradeKey);
      const rangeText = fyInfo.rangeText ? ` (${fyInfo.rangeText})` : "";
      fyNote.textContent =
        `${fyInfo.gradeLabel}: max(t_f, t_w) = ${fyInfo.thickness.toFixed(1)} mm${rangeText} → fy = ${fyInfo.fy.toFixed(0)} MPa (nominal ${fyInfo.nominalFy.toFixed(0)} MPa).`;
    }

    function setGoverningChipMessage(message, statusClass = null) {
      const chip = document.getElementById("governing-chip");
      if (!chip) return;
      chip.textContent = message;
      UTILIZATION_CLASSES.forEach(cls => chip.classList.remove(cls));
      if (statusClass) {
        chip.classList.add(statusClass);
      }
    }

    function formatSci(x) {
      if (!isFinite(x)) return x.toString();
      const abs = Math.abs(x);
      if (abs === 0) return "0";
      if (abs >= 1e4 || abs < 1e-2) {
        const exp = Math.floor(Math.log10(abs));
        const mant = x / Math.pow(10, exp);
        return mant.toFixed(3) + " × 10^" + exp;
      }
      return x.toFixed(1);
    }

    function updateSectionTable(sec) {
      const tbody = document.querySelector("#section-table tbody");
      tbody.innerHTML = "";

      function addRow(label, value, unit) {
        const tr = document.createElement("tr");
        const tdLabel = document.createElement("td");
        tdLabel.className = "label";
        tdLabel.textContent = label;
        const tdVal = document.createElement("td");
        tdVal.textContent = value;
        const tdUnit = document.createElement("td");
        tdUnit.textContent = unit || "";
        tr.appendChild(tdLabel);
        tr.appendChild(tdVal);
        tr.appendChild(tdUnit);
        tbody.appendChild(tr);
      }

      addRow("Type", sec.type, "");
      addRow("Depth h", sec.h.toFixed(1), "mm");
      addRow("Flange width b", sec.b.toFixed(1), "mm");
      addRow("Web thickness t_w", sec.tw.toFixed(2), "mm");
      addRow("Flange thickness t_f", sec.tf.toFixed(2), "mm");
      addRow("Fillet radius r", sec.r.toFixed(1), "mm");
      addRow("Area A", sec.A.toFixed(0), "mm²");
      addRow("I_y (major)", formatSci(sec.Iy), "mm⁴");
      addRow("I_z (minor)", formatSci(sec.Iz), "mm⁴");
      addRow("W_pl,y", formatSci(sec.Wpl_y), "mm³");
      addRow("W_pl,z", formatSci(sec.Wpl_z), "mm³");
      addRow("W_el,y", formatSci(sec.Wel_y), "mm³");
      addRow("W_el,z", formatSci(sec.Wel_z), "mm³");
      addRow("A_v,y (shear)", sec.Av_y.toFixed(0), "mm²");
      addRow("A_v,z (shear)", sec.Av_z.toFixed(0), "mm²");
    }

    function drawSectionDiagram(sec) {
      const svg = document.getElementById("section-diagram");
      svg.setAttribute("viewBox", "0 0 220 220");
      while (svg.firstChild) svg.removeChild(svg.firstChild);

      const drawHeight = 180;
      const scale = drawHeight / sec.h;
      const totalWidthPx = sec.b * scale;
      const offsetX = (220 - totalWidthPx) / 2;
      const offsetY = (220 - drawHeight) / 2;

      const flangeHeightPx = sec.tf * scale;
      const webThicknessPx = Math.max(sec.tw * scale, 2);
      const webX = offsetX + (totalWidthPx - webThicknessPx) / 2;
      const webY = offsetY + flangeHeightPx;
      const webHeight = drawHeight - 2 * flangeHeightPx;

      function rect(x, y, w, h, fill) {
        const r = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        r.setAttribute("x", x);
        r.setAttribute("y", y);
        r.setAttribute("width", w);
        r.setAttribute("height", h);
        r.setAttribute("fill", fill);
        r.setAttribute("opacity", "0.9");
        svg.appendChild(r);
      }

      rect(offsetX, offsetY, totalWidthPx, flangeHeightPx, "#4f46e5");
      rect(offsetX, offsetY + drawHeight - flangeHeightPx, totalWidthPx, flangeHeightPx, "#4f46e5");
      rect(webX, webY, webThicknessPx, webHeight, "#818cf8");

      const axisY = document.createElementNS("http://www.w3.org/2000/svg", "line");
      axisY.setAttribute("x1", 110);
      axisY.setAttribute("y1", 15);
      axisY.setAttribute("x2", 110);
      axisY.setAttribute("y2", 205);
      axisY.setAttribute("stroke", "#9ca3af");
      axisY.setAttribute("stroke-dasharray", "4 4");
      axisY.setAttribute("stroke-width", "1");
      svg.appendChild(axisY);

      const axisZ = document.createElementNS("http://www.w3.org/2000/svg", "line");
      axisZ.setAttribute("x1", 15);
      axisZ.setAttribute("y1", 110);
      axisZ.setAttribute("x2", 205);
      axisZ.setAttribute("y2", 110);
      axisZ.setAttribute("stroke", "#9ca3af");
      axisZ.setAttribute("stroke-dasharray", "4 4");
      axisZ.setAttribute("stroke-width", "1");
      svg.appendChild(axisZ);

      const labelY = document.createElementNS("http://www.w3.org/2000/svg", "text");
      labelY.setAttribute("x", 116);
      labelY.setAttribute("y", 28);
      labelY.setAttribute("fill", "#6b7280");
      labelY.setAttribute("font-size", "10");
      labelY.textContent = "y";
      svg.appendChild(labelY);

      const labelZ = document.createElementNS("http://www.w3.org/2000/svg", "text");
      labelZ.setAttribute("x", 192);
      labelZ.setAttribute("y", 105);
      labelZ.setAttribute("fill", "#6b7280");
      labelZ.setAttribute("font-size", "10");
      labelZ.textContent = "z";
      svg.appendChild(labelZ);
    }

    function updateSectionInfo() {
      const name = document.getElementById("section-select").value;
      const sec = SECTIONS[name];
      if (sec) {
        updateSectionTable(sec);
        drawSectionDiagram(sec);
      }
      updateFyInfo();
    }

    function escapeHtml(str) {
      return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt/")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    }

    // ---- Section classification (simplified EC3) ----
    function classifySection(sec, fy) {
      const eps = Math.sqrt(235 / fy);

      // flange outstand (compression flange in bending)
      const c = (sec.b - sec.tw) / 2; // mm
      const t_f = sec.tf;
      const cOverTf = c / t_f;

      let flangeClass;
      if (cOverTf <= 9 * eps) flangeClass = 1;
      else if (cOverTf <= 10 * eps) flangeClass = 2;
      else if (cOverTf <= 14 * eps) flangeClass = 3;
      else flangeClass = 4;

      // web clear depth between fillets
      const d = Math.max(sec.h - 2 * sec.tf - 2 * sec.r, 0.0);
      const dOverTw = d / sec.tw;

      let webClass;
      if (dOverTw <= 72 * eps) webClass = 1;
      else if (dOverTw <= 83 * eps) webClass = 2;
      else if (dOverTw <= 124 * eps) webClass = 3;
      else webClass = 4;

      const governing = Math.max(flangeClass, webClass);

      return {
        flangeClass,
        webClass,
        governing,
        eps,
        cOverTf,
        dOverTw
      };
    }

    // ---- Calculation ----
    function calculate() {
      const resultsDiv = document.getElementById("results");
      setGoverningChipMessage("Calculating...");
      const sectionName = document.getElementById("section-select").value;
      const sec = SECTIONS[sectionName];
      if (!sec) {
        resultsDiv.textContent = "No section selected or sections.json not loaded.";
        setGoverningChipMessage("Select a section before calculating.");
        return;
      }

      const gradeKey = document.getElementById("steel-grade").value;
      const fyInfo = resolveFyForSection(sec, gradeKey);
      const fy = fyInfo.fy;
      const alphaY = BUCKLING_CURVES[document.getElementById("buckling-curve-y").value];
      const alphaZ = BUCKLING_CURVES[document.getElementById("buckling-curve-z").value];

      const LcrY_m = parseFloat(document.getElementById("length-y").value || "0");
      const LcrZ_m = parseFloat(document.getElementById("length-z").value || "0");
      if (LcrY_m <= 0 || LcrZ_m <= 0) {
        resultsDiv.textContent = "Both effective lengths Lcr,y and Lcr,z must be > 0.";
        setGoverningChipMessage("Provide valid effective lengths.");
        return;
      }

      // Loads (kN, kNm) -> N, Nmm
      const NEd_kN = parseFloat(document.getElementById("ned").value || "0");
      const MyEd_kNm = parseFloat(document.getElementById("myed").value || "0");
      const MzEd_kNm = parseFloat(document.getElementById("mzed").value || "0");
      const VyEd_kN = parseFloat(document.getElementById("vyed").value || "0");
      const VzEd_kN = parseFloat(document.getElementById("vzed").value || "0");

      const NEd = NEd_kN * 1000;
      const MyEd = MyEd_kNm * 1e6;
      const MzEd = MzEd_kNm * 1e6;
      const VyEd = VyEd_kN * 1000;
      const VzEd = VzEd_kN * 1000;

      const A = sec.A;
      const Iy = sec.Iy;
      const Iz = sec.Iz;
      const Av_y = sec.Av_y;
      const Av_z = sec.Av_z;

      const LcrY_mm = LcrY_m * 1000;
      const LcrZ_mm = LcrZ_m * 1000;

      let steps = "";
      steps += "=== EUROCODE 3 MEMBER CHECK (EN 1993-1-1) ===\n";
      steps += "Section: " + sec.name + " (" + sec.type + ")\n";
      steps += "Steel grade: " + fyInfo.gradeLabel +
        " (nominal fy = " + fyInfo.nominalFy.toFixed(0) + " MPa)\n";
      if (fyInfo.thickness != null) {
        const rangeDetail = fyInfo.rangeText ? " [" + fyInfo.rangeText + "]" : "";
        steps += "Thickness control: max(t_f, t_w) = " + fyInfo.thickness.toFixed(1) +
          " mm" + rangeDetail + " -> adopted fy = " + fy.toFixed(0) + " MPa\n";
      }
      steps += "Buckling curves: y-y: α = " + alphaY.toFixed(2) + ", z-z: α = " + alphaZ.toFixed(2) + "\n";
      steps += "Effective lengths: L_cr,y = " + LcrY_m.toFixed(3) + " m, L_cr,z = " + LcrZ_m.toFixed(3) + " m\n";

      // --- Section classification ---
      steps += "\n--- 0) Section classification (simplified EC3) ---\n";
      const cls = classifySection(sec, fy);
      steps += "ε = sqrt(235 / fy) = " + cls.eps.toFixed(3) + "\n";
      steps += "Flange outstand c = (b - t_w) / 2 = " + ((sec.b - sec.tw) / 2).toFixed(1) + " mm\n";
      steps += "c / t_f = " + cls.cOverTf.toFixed(2) + " → flange class = " + cls.flangeClass + "\n";
      steps += "Web clear depth d ≈ h - 2·t_f - 2·r = " + (sec.h - 2 * sec.tf - 2 * sec.r).toFixed(1) + " mm\n";
      steps += "d / t_w = " + cls.dOverTw.toFixed(2) + " → web class = " + cls.webClass + "\n";
      steps += "Governing cross-section class = " + cls.governing + "\n";

      // Choose section moduli based on class
      let Wy_eff, Wz_eff, classNote;
      if (cls.governing <= 2) {
        Wy_eff = sec.Wpl_y;
        Wz_eff = sec.Wpl_z;
        classNote = "Class 1/2 → plastic behaviour, using W_pl for both axes.";
      } else if (cls.governing === 3) {
        Wy_eff = sec.Wel_y;
        Wz_eff = sec.Wel_z;
        classNote = "Class 3 → elastic behaviour, using W_el for both axes.";
      } else {
        Wy_eff = sec.Wel_y;
        Wz_eff = sec.Wel_z;
        classNote = "Class 4 → effective widths NOT implemented in this tool.";
      }
      steps += classNote + "\n";

      if (cls.governing === 4) {
        steps += "\nSection is Class 4 (slender). Effective cross-section design (reduced thickness / effective widths)\n";
        steps += "is not implemented in this simplified tool. Please choose a more compact section (Class 1–3).\n";
        resultsDiv.textContent = steps;
        setGoverningChipMessage("Section is Class 4 - calculation not available.");
        return;
      }

      // ---- 1) Basic section resistances (no buckling, no shear reduction yet) ----
      steps += "\n--- 1) Basic section resistances (no buckling, no shear reduction yet) ---\n";
      const Npl_Rd = A * fy / gammaM0;
      const My_Rd_base = Wy_eff * fy / gammaM0;
      const Mz_Rd_base = Wz_eff * fy / gammaM0;

      const Vypl_Rd = Av_y * fy / (Math.sqrt(3) * gammaM0);
      const Vzpl_Rd = Av_z * fy / (Math.sqrt(3) * gammaM0);

      steps += "A = " + A.toFixed(0) + " mm²\n";
      steps += "N_pl,Rd = A·fy / γ_M0 = " + (Npl_Rd / 1000).toFixed(1) + " kN\n";
      steps += "W_y,eff = " + formatSci(Wy_eff) + " mm³ → M_y,Rd(base) = " + (My_Rd_base / 1e6).toFixed(1) + " kNm\n";
      steps += "W_z,eff = " + formatSci(Wz_eff) + " mm³ → M_z,Rd(base) = " + (Mz_Rd_base / 1e6).toFixed(1) + " kNm\n";
      steps += "A_v,y = " + Av_y.toFixed(0) + " mm² → V_pl,y,Rd = " + (Vypl_Rd / 1000).toFixed(1) + " kN\n";
      steps += "A_v,z = " + Av_z.toFixed(0) + " mm² → V_pl,z,Rd = " + (Vzpl_Rd / 1000).toFixed(1) + " kN\n";

      // ---- 2) Applied design actions ----
      steps += "\n--- 2) Applied design actions ---\n";
      steps += "N_Ed  = " + NEd_kN.toFixed(1) + " kN (compression > 0)\n";
      steps += "M_y,Ed = " + MyEd_kNm.toFixed(1) + " kNm\n";
      steps += "M_z,Ed = " + MzEd_kNm.toFixed(1) + " kNm\n";
      steps += "V_y,Ed = " + VyEd_kN.toFixed(1) + " kN\n";
      steps += "V_z,Ed = " + VzEd_kN.toFixed(1) + " kN\n";

      // ---- 3) Shear check and high shear reduction ----
      steps += "\n--- 3) Shear checks and high-shear moment reduction (EN 1993-1-1, 6.2.8) ---\n";
      const etaVy = Vypl_Rd > 0 ? VyEd / Vypl_Rd : 0;
      const etaVz = Vzpl_Rd > 0 ? VzEd / Vzpl_Rd : 0;

      let shearSummary = "";
      shearSummary += "Shear ratio η_Vy = V_y,Ed / V_pl,y,Rd = " + etaVy.toFixed(3);
      if (etaVy > 1.0) shearSummary += "  (FAIL, V_y,Ed > V_pl,y,Rd)";
      else if (etaVy > 0.5) shearSummary += "  (HIGH SHEAR, > 0.5·V_pl,y,Rd)";
      else shearSummary += "  (normal shear)";
      shearSummary += "\n";

      shearSummary += "Shear ratio η_Vz = V_z,Ed / V_pl,z,Rd = " + etaVz.toFixed(3);
      if (etaVz > 1.0) shearSummary += "  (FAIL, V_z,Ed > V_pl,z,Rd)";
      else if (etaVz > 0.5) shearSummary += "  (HIGH SHEAR, > 0.5·V_pl,z,Rd)";
      else shearSummary += "  (normal shear)";
      shearSummary += "\n";
      steps += shearSummary;

      // High shear reduction of bending resistances:
      let MyRd = My_Rd_base;
      let MzRd = Mz_Rd_base;
      let rhoY = 0;
      let rhoZ = 0;

      // Shear Vz influences My
      if (etaVz > 0.5 && etaVz <= 1.0) {
        rhoZ = Math.pow(2 * etaVz - 1, 2);
        MyRd = My_Rd_base * Math.max(0, (1 - rhoZ));
        steps += "For V_z,Ed > 0.5·V_pl,z,Rd: ρ_z = (2·η_Vz - 1)² = " + rhoZ.toFixed(3) + "\n";
        steps += "→ Reduced major-axis bending resistance: M_y,Rd = (1 - ρ_z)·M_y,Rd(base) = " + (MyRd / 1e6).toFixed(1) + " kNm\n";
      } else {
        steps += "No reduction of M_y,Rd due to V_z,Ed (η_Vz ≤ 0.5 or shear failed).\n";
      }

      // Shear Vy influences Mz
      if (etaVy > 0.5 && etaVy <= 1.0) {
        rhoY = Math.pow(2 * etaVy - 1, 2);
        MzRd = Mz_Rd_base * Math.max(0, (1 - rhoY));
        steps += "For V_y,Ed > 0.5·V_pl,y,Rd: ρ_y = (2·η_Vy - 1)² = " + rhoY.toFixed(3) + "\n";
        steps += "→ Reduced minor-axis bending resistance: M_z,Rd = (1 - ρ_y)·M_z,Rd(base) = " + (MzRd / 1e6).toFixed(1) + " kNm\n";
      } else {
        steps += "No reduction of M_z,Rd due to V_y,Ed (η_Vy ≤ 0.5 or shear failed).\n";
      }

      // ---- 4) Section check (no member buckling) ----
      steps += "\n--- 4) Cross-section interaction check (no member buckling) ---\n";
      const etaN_sec = Npl_Rd > 0 ? NEd / Npl_Rd : 0;
      const etaMy_sec = MyRd > 0 ? Math.abs(MyEd) / MyRd : 0;
      const etaMz_sec = MzRd > 0 ? Math.abs(MzEd) / MzRd : 0;
      const eta_sec_comb = etaN_sec + etaMy_sec + etaMz_sec;

      steps += "η_N,sec  = N_Ed / N_pl,Rd = " + etaN_sec.toFixed(3) + "\n";
      steps += "η_My,sec = |M_y,Ed| / M_y,Rd = " + etaMy_sec.toFixed(3) + "\n";
      steps += "η_Mz,sec = |M_z,Ed| / M_z,Rd = " + etaMz_sec.toFixed(3) + "\n";
      steps += "Section interaction (simplified): η_sec = η_N,sec + η_My,sec + η_Mz,sec = " + eta_sec_comb.toFixed(3) + "\n";

      // ---- 5) Member buckling in compression (y-y, z-z) ----
      steps += "\n--- 5) Member buckling in compression (flexural y-y and z-z) ---\n";

      // y-y
      const NcrY = Math.PI * Math.PI * E * Iy / (LcrY_mm * LcrY_mm);
      const lambdaBarY = NcrY > 0 ? Math.sqrt((A * fy) / NcrY) : 0;
      const phiY = 0.5 * (1 + alphaY * (lambdaBarY - 0.2) + lambdaBarY * lambdaBarY);
      let chiY = 1 / (phiY + Math.sqrt(Math.max(phiY * phiY - lambdaBarY * lambdaBarY, 0)));
      chiY = Math.min(chiY, 1.0);
      const NbY_Rd = chiY * A * fy / gammaM1;

      steps += "y-y:\n";
      steps += "  N_cr,y = π²·E·I_y / L_cr,y² = " + formatSci(NcrY) + " N\n";
      steps += "  λ̄_y = sqrt(A·fy / N_cr,y) = " + lambdaBarY.toFixed(3) + "\n";
      steps += "  φ_y = 0.5·[1 + α_y(λ̄_y - 0.2) + λ̄_y²] = " + phiY.toFixed(3) + "\n";
      steps += "  χ_y = 1 / [φ_y + √(φ_y² - λ̄_y²)] = " + chiY.toFixed(3) + "\n";
      steps += "  N_b,y,Rd = χ_y·A·fy / γ_M1 = " + (NbY_Rd / 1000).toFixed(1) + " kN\n";

      // z-z
      const NcrZ = Math.PI * Math.PI * E * Iz / (LcrZ_mm * LcrZ_mm);
      const lambdaBarZ = NcrZ > 0 ? Math.sqrt((A * fy) / NcrZ) : 0;
      const phiZ = 0.5 * (1 + alphaZ * (lambdaBarZ - 0.2) + lambdaBarZ * lambdaBarZ);
      let chiZ = 1 / (phiZ + Math.sqrt(Math.max(phiZ * phiZ - lambdaBarZ * lambdaBarZ, 0)));
      chiZ = Math.min(chiZ, 1.0);
      const NbZ_Rd = chiZ * A * fy / gammaM1;

      steps += "z-z:\n";
      steps += "  N_cr,z = π²·E·I_z / L_cr,z² = " + formatSci(NcrZ) + " N\n";
      steps += "  λ̄_z = sqrt(A·fy / N_cr,z) = " + lambdaBarZ.toFixed(3) + "\n";
      steps += "  φ_z = 0.5·[1 + α_z(λ̄_z - 0.2) + λ̄_z²] = " + phiZ.toFixed(3) + "\n";
      steps += "  χ_z = 1 / [φ_z + √(φ_z² - λ̄_z²)] = " + chiZ.toFixed(3) + "\n";
      steps += "  N_b,z,Rd = χ_z·A·fy / γ_M1 = " + (NbZ_Rd / 1000).toFixed(1) + " kN\n";

      // ---- 6) LTB for major-axis bending (EN 1993-1-1, 6.3.2.2 / Eq. 6.56) ----
      steps += "\n--- 6) Lateral-torsional buckling (LTB) for major-axis bending ---\n";
      const ltCurveAlpha = sec.h / sec.b > 2 ? BUCKLING_CURVES.b : BUCKLING_CURVES.a;
      const Lb = LcrZ_mm; // use Minor-axis effective length as unbraced length
      const kz = 1.0;

      // Section torsion / warping properties (thin-wall approximation, fillet ignored)
      const It = 2 * (sec.b * Math.pow(sec.tf, 3) / 3) + ((sec.h - 2 * sec.tf) * Math.pow(sec.tw, 3) / 3);
      const dWarp = sec.h - sec.tf; // distance between flange centroids ~ h - t_f
      const Iw = (sec.Iz * Math.pow(dWarp, 2)) / 4;

      const kzL = kz * Lb;
      
      const pref = (Math.PI * Math.PI * E * sec.Iz) / (kzL * kzL);
      const inside = (kzL * kzL * G * It) / (Math.PI * Math.PI * E * sec.Iz) +
                     (Iw / sec.Iz);
      const Mcr = pref * Math.sqrt(Math.max(inside, 0));

      if (!(Mcr > 0)) {
        steps += "LTB: Unable to compute M_cr (check dimensions / lengths).\n";
        resultsDiv.textContent = steps;
        setGoverningChipMessage("LTB Mcr not computable.");
        return;
      }

      const MyRk_for_LT = Wy_eff * fy; // characteristic moment about major axis
      const lambdaBarLT = Math.sqrt(MyRk_for_LT / Mcr);
      const phiLT = 0.5 * (1 + ltCurveAlpha * (lambdaBarLT - 0.2) + lambdaBarLT * lambdaBarLT);
      let chiLT = 1 / (phiLT + Math.sqrt(Math.max(phiLT * phiLT - lambdaBarLT * lambdaBarLT, 0)));
      chiLT = Math.min(chiLT, 1.0);
      const Myb_Rd = chiLT * MyRd;
      const Mzcb_Rd = MzRd;

      steps += "Assumptions: C1 = 1.0, kz = 1.0, L_b = L_cr,z.\n";
      steps += "  Torsion constant I_t ≈ 2·(b·t_f³/3) + (h-2t_f)·t_w³/3 = " + formatSci(It) + " mm⁴\n";
      steps += "  Warping constant I_ω ≈ I_z·(h - t_f)² / 4 = " + formatSci(Iw) + " mm⁶\n";
      steps += "  Buckling curve for LTB: " + (sec.h / sec.b > 2 ? "curve b (α = 0.34)" : "curve a (α = 0.21)") + "\n";
      steps += "  M_cr = " + formatSci(Mcr) + " Nmm\n";
      steps += "  λ̄_LT = sqrt(M_y,Rk / M_cr) = " + lambdaBarLT.toFixed(3) + "\n";
      steps += "  φ_LT = 0.5·[1 + α_LT(λ̄_LT - 0.2) + λ̄_LT²] = " + phiLT.toFixed(3) + "\n";
      steps += "  χ_LT = 1 / [φ_LT + sqrt(φ_LT² - λ̄_LT²)] = " + chiLT.toFixed(3) + "\n";
      steps += "  M_y,b,Rd = χ_LT·M_y,Rd = " + (Myb_Rd / 1e6).toFixed(1) + " kNm\n";
      steps += "  M_z,cb,Rd (no LTB) = M_z,Rd = " + (Mzcb_Rd / 1e6).toFixed(1) + " kNm\n";

      // ---- 7) Member interaction checks (EC3 6.61, 6.62 form) ----
      steps += "\n--- 7) Member interaction checks (EN 1993-1-1, 6.3.3 – Eqs. 6.61 & 6.62) ---\n";

      const Nyb_Rd = NbY_Rd;
      const Nzb_Rd = NbZ_Rd;

      // k-factors (simple conservative values)
      const kyy = 1.0;
      const kyz = 1.5;
      const kzy = 1.0;
      const kzz = 1.5;

      steps += "Interaction factors adopted:\n";
      steps += "  k_yy = " + kyy.toFixed(2) + ", k_yz = " + kyz.toFixed(2) +
               ", k_zy = " + kzy.toFixed(2) + ", k_zz = " + kzz.toFixed(2) + "\n";

      const termN_y = Nyb_Rd > 0 ? NEd / Nyb_Rd : 0;
      const termMy_y = Myb_Rd > 0 ? Math.abs(MyEd) / Myb_Rd : 0;
      const termMz_y = Mzcb_Rd > 0 ? Math.abs(MzEd) / Mzcb_Rd : 0;
      const eta_y = termN_y + kyy * termMy_y + kyz * termMz_y;

      steps += "\nBuckling about y-y (major axis) – Eq. 6.61 form:\n";
      steps += "  η_N,y  = N_Ed / N_y,b,Rd = " + termN_y.toFixed(3) + "\n";
      steps += "  η_My,y = |M_y,Ed| / M_y,b,Rd = " + termMy_y.toFixed(3) + "\n";
      steps += "  η_Mz,y = |M_z,Ed| / M_z,cb,Rd = " + termMz_y.toFixed(3) + "\n";
      steps += "  η_y = η_N,y + k_yy·η_My,y + k_yz·η_Mz,y\n";
      steps += "      = " + termN_y.toFixed(3) + " + "
            + kyy.toFixed(2) + "·" + termMy_y.toFixed(3)
            + " + " + kyz.toFixed(2) + "·" + termMz_y.toFixed(3)
            + " = " + eta_y.toFixed(3) + "  ≤ 1.0\n";

      const termN_z = Nzb_Rd > 0 ? NEd / Nzb_Rd : 0;
      const termMy_z = Myb_Rd > 0 ? Math.abs(MyEd) / Myb_Rd : 0;
      const termMz_z = Mzcb_Rd > 0 ? Math.abs(MzEd) / Mzcb_Rd : 0;
      const eta_z = termN_z + kzy * termMy_z + kzz * termMz_z;

      steps += "\nBuckling about z-z (minor axis) – Eq. 6.62 form:\n";
      steps += "  η_N,z  = N_Ed / N_z,b,Rd = " + termN_z.toFixed(3) + "\n";
      steps += "  η_My,z = |M_y,Ed| / M_y,b,Rd = " + termMy_z.toFixed(3) + "\n";
      steps += "  η_Mz,z = |M_z,Ed| / M_z,cb,Rd = " + termMz_z.toFixed(3) + "\n";
      steps += "  η_z = η_N,z + k_zy·η_My,z + k_zz·η_Mz,z\n";
      steps += "      = " + termN_z.toFixed(3) + " + "
            + kzy.toFixed(2) + "·" + termMy_z.toFixed(3)
            + " + " + kzz.toFixed(2) + "·" + termMz_z.toFixed(3)
            + " = " + eta_z.toFixed(3) + "  ≤ 1.0\n";

      // ---- 8) Summary ----
      steps += "\n--- 8) Summary of key utilization ratios ---\n";
      const etaVy_abs = Math.abs(etaVy);
      const etaVz_abs = Math.abs(etaVz);

      steps += "Section interaction (no buckling): η_sec = " + eta_sec_comb.toFixed(3) + "\n";
      steps += "Buckling interaction about y-y: η_y = " + eta_y.toFixed(3) + "\n";
      steps += "Buckling interaction about z-z: η_z = " + eta_z.toFixed(3) + "\n";
      steps += "Shear ratios: η_Vy = " + etaVy_abs.toFixed(3) + ", η_Vz = " + etaVz_abs.toFixed(3) + "\n";

      const governing = Math.max(
        eta_sec_comb,
        eta_y,
        eta_z,
        etaVy_abs,
        etaVz_abs
      );

      let statusText = "";
      let statusClass = "";
      if (governing <= 1.0) {
        statusText = "OK (<= 1.0)";
        statusClass = "util-ok";
      } else if (governing <= 1.05) {
        statusText = "Marginal (> 1.0, check carefully)";
        statusClass = "util-high";
      } else {
        statusText = "NOT OK (> 1.0)";
        statusClass = "util-ng";
      }

      setGoverningChipMessage(
        "Governing η = " + governing.toFixed(3) + " (" + statusText + ")",
        statusClass
      );

      function shearFlag(eta) {
        if (eta > 1.0) {
          return '<span class="shear-flag shear-fail">Shear FAIL</span>';
        } else if (eta > 0.5) {
          return '<span class="shear-flag shear-high">High shear</span>';
        }
        return '<span class="shear-flag shear-normal">Normal shear</span>';
      }

      let html = steps + "\n";
      html += 'Governing utilization ratio: ';
      html += '<span class="utilization-badge ' + statusClass + '">';
      html += governing.toFixed(3) + " – " + statusText + "</span>";
      html += "<br/><br/>";
      html += "Shear status Vy: " + shearFlag(etaVy_abs) + "   ";
      html += "Shear status Vz: " + shearFlag(etaVz_abs);

      resultsDiv.innerHTML = html;
    }

    document.addEventListener("DOMContentLoaded", () => {
      loadSectionsFromJSON();
      document.getElementById("section-select").addEventListener("change", updateSectionInfo);
      document.getElementById("steel-grade").addEventListener("change", updateFyInfo);
      document.getElementById("calc-btn").addEventListener("click", calculate);
      setGoverningChipMessage("Governing η: —");
    });
