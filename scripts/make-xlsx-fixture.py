# Builds a stand-in for the company's "Formato Reporte de Horas Extra.xlsx" (two tabs, a table, colors, banded rows, a date
# column, links) so the filler can be tested without the real file. Usage: python3 scripts/make-xlsx-fixture.py [formulas]
import sys, datetime
from openpyxl import Workbook
from openpyxl.styles import PatternFill, Font, Alignment
from openpyxl.worksheet.table import Table, TableStyleInfo

formulas = len(sys.argv) > 1 and sys.argv[1] == "formulas"
wb = Workbook()
rs = wb.active
rs.title = "Resumen"
red = PatternFill("solid", fgColor="C00000")
gray = PatternFill("solid", fgColor="D9D9D9")
rs.merge_cells("A1:F1")
rs["A1"] = "RESUMEN DE CLASES EXTRACURRICULARES"
rs["A1"].font = Font(size=24, bold=True, color="FFF2CC")
rs["A1"].fill = red
for i, h in enumerate(["Docente", "Mes-Año", "Horas Perdidas", "Horas Recuperadas", "Horas Extra", "Colaboraciones"], start=1):
    c = rs.cell(row=2, column=i, value=h)
    c.fill = red; c.font = Font(bold=True, color="FFFFFF"); c.alignment = Alignment(horizontal="center")
rs.append(["Juan Lopez", "Enero-2026", 10, 10, 2, 3])
for c in rs[3]:
    c.fill = gray
if formulas:
    rs["E3"] = "=SUMIFS('Reporte detallado'!A:A,'Reporte detallado'!D:D,\"Hora Extra\")"

rd = wb.create_sheet("Reporte detallado")
heads = ["Fecha", "Horario", "Grupo o estudiante", "Tipo de clase", "Solicitud", "Evidencia", "Información adicional y detalles"]
for i, h in enumerate(heads, start=1):
    c = rd.cell(row=1, column=i, value=h)
    c.fill = PatternFill("solid", fgColor="000000"); c.font = Font(bold=True, color="FFFFFF")
sample = [
    (datetime.date(2026, 1, 4), "De 8 a 9 PM", "A1-20", "Recuperación", "Propia", "https://drive.google.com/x1", "Se recuperó una clase"),
    (datetime.date(2026, 1, 10), "De 3 a 4 PM", "Manuel Rodriguez", "Hora Extra", "Academia", "https://drive.google.com/x2", "La academia solicitó"),
    (datetime.date(2026, 1, 25), "De 10 a 11 AM", "B2-9", "Colaboración", "Felipe Gonzalez", "https://drive.google.com/x3", "Felipe no tenía luz"),
]
for r, row in enumerate(sample, start=2):
    for cidx, v in enumerate(row, start=1):
        c = rd.cell(row=r, column=cidx, value=v)
        if cidx == 1:
            c.number_format = "d-mmm-yy"
        if cidx == 6:
            c.hyperlink = v; c.font = Font(color="0563C1", underline="single")
        if r % 2 == 1:
            c.fill = gray
# pre-formatted empty rows (banded), like the company file
for r in range(5, 18):
    for cidx in range(1, 8):
        c = rd.cell(row=r, column=cidx)
        c.number_format = "d-mmm-yy" if cidx == 1 else "General"
        if r % 2 == 1:
            c.fill = gray
t = Table(displayName="Tabla2", ref="A1:G4")
t.tableStyleInfo = TableStyleInfo(name="TableStyleMedium2", showRowStripes=True)
rd.add_table(t)
for col, w in zip("ABCDEFG", [12, 16, 22, 16, 18, 30, 50]):
    rd.column_dimensions[col].width = w
out = "scripts/fixtures/formato-ejemplo-formulas.xlsx" if formulas else "scripts/fixtures/formato-ejemplo.xlsx"
wb.save(out)
print("saved", out)
