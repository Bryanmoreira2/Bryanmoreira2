import PDFDocument from 'pdfkit';
import { formatarDataHora } from './dates.js';

export interface Coluna {
  titulo: string;
  largura: number; // proporção relativa
  alinhamento?: 'left' | 'right' | 'center';
}

export interface Cabecalho {
  titulo: string;
  subtitulo?: string;
  numero: string;
  linhas: Array<[string, string]>;
  marcaDagua?: string;
}

const MARGEM = 48;

/** Documento A4 legível para impressão (RNF-011). */
export class Relatorio {
  doc: PDFKit.PDFDocument;
  private chunks: Buffer[] = [];
  private fim: Promise<Buffer>;

  constructor(private cab: Cabecalho) {
    this.doc = new PDFDocument({ size: 'A4', margin: MARGEM, bufferPages: true, info: { Title: `${cab.titulo} — ${cab.numero}`, Author: 'NEXO JOVEM' } });
    this.fim = new Promise((resolve) => {
      this.doc.on('data', (c: Buffer) => this.chunks.push(c));
      this.doc.on('end', () => resolve(Buffer.concat(this.chunks)));
    });
    this.cabecalho();
  }

  get largura() {
    return this.doc.page.width - MARGEM * 2;
  }

  private cabecalho() {
    const d = this.doc;
    d.font('Helvetica-Bold').fontSize(9).fillColor('#555').text('NEXO JOVEM', MARGEM, MARGEM);
    d.font('Helvetica-Bold').fontSize(16).fillColor('#000').text(this.cab.titulo, { width: this.largura });
    if (this.cab.subtitulo) d.font('Helvetica').fontSize(10).fillColor('#333').text(this.cab.subtitulo);
    d.moveDown(0.4);
    d.font('Helvetica').fontSize(9).fillColor('#000');
    d.text(`Nº ${this.cab.numero}`, { continued: false });
    for (const [k, v] of this.cab.linhas) d.font('Helvetica-Bold').text(`${k}: `, { continued: true }).font('Helvetica').text(v);
    d.moveDown(0.5);
    this.linha();
    d.moveDown(0.6);
  }

  linha() {
    const y = this.doc.y;
    this.doc.moveTo(MARGEM, y).lineTo(MARGEM + this.largura, y).lineWidth(0.5).strokeColor('#999').stroke();
  }

  secao(titulo: string) {
    this.garantirEspaco(50);
    this.doc.moveDown(0.6).font('Helvetica-Bold').fontSize(11).fillColor('#000').text(titulo, MARGEM);
    this.doc.moveDown(0.3);
  }

  paragrafo(texto: string, opts: { negrito?: boolean; tamanho?: number; cor?: string } = {}) {
    this.doc.font(opts.negrito ? 'Helvetica-Bold' : 'Helvetica').fontSize(opts.tamanho ?? 9.5).fillColor(opts.cor ?? '#000').text(texto, MARGEM, undefined, { width: this.largura });
  }

  pares(itens: Array<[string, string]>) {
    for (const [k, v] of itens) {
      this.garantirEspaco(16);
      const y = this.doc.y;
      this.doc.font('Helvetica').fontSize(9.5).fillColor('#000').text(k, MARGEM, y, { width: this.largura * 0.6 });
      this.doc.font('Helvetica-Bold').text(v, MARGEM + this.largura * 0.6, y, { width: this.largura * 0.4, align: 'right' });
      this.doc.moveDown(0.15);
    }
  }

  tabela(colunas: Coluna[], linhas: string[][], opts: { totais?: string[] } = {}) {
    const d = this.doc;
    const soma = colunas.reduce((s, c) => s + c.largura, 0);
    const larguras = colunas.map((c) => (c.largura / soma) * this.largura);
    const desenharLinha = (valores: string[], estilo: 'cab' | 'normal' | 'total', zebra = false) => {
      d.font(estilo === 'normal' ? 'Helvetica' : 'Helvetica-Bold').fontSize(8.5);
      const altura = Math.max(...valores.map((v, i) => d.heightOfString(v || ' ', { width: larguras[i]! - 6 }))) + 6;
      if (d.y + altura > d.page.height - MARGEM - 30) {
        d.addPage();
        if (estilo !== 'cab') desenharLinha(colunas.map((c) => c.titulo), 'cab');
      }
      const y = d.y;
      if (estilo === 'cab') d.rect(MARGEM, y, this.largura, altura).fill('#e8e8e8');
      else if (zebra) d.rect(MARGEM, y, this.largura, altura).fill('#f6f6f6');
      d.fillColor('#000');
      let x = MARGEM;
      valores.forEach((v, i) => {
        d.text(v ?? '', x + 3, y + 3, { width: larguras[i]! - 6, align: colunas[i]!.alinhamento ?? 'left' });
        x += larguras[i]!;
      });
      d.y = y + altura;
      if (estilo === 'total') {
        d.moveTo(MARGEM, y).lineTo(MARGEM + this.largura, y).lineWidth(0.5).strokeColor('#666').stroke();
      }
    };
    this.garantirEspaco(40);
    desenharLinha(colunas.map((c) => c.titulo), 'cab');
    if (linhas.length === 0) {
      d.font('Helvetica-Oblique').fontSize(8.5).text('Nenhum registro no período.', MARGEM + 3, d.y + 3);
      d.moveDown(0.5);
    }
    linhas.forEach((l, i) => desenharLinha(l, 'normal', i % 2 === 1));
    if (opts.totais) desenharLinha(opts.totais, 'total');
    d.x = MARGEM;
    d.moveDown(0.5);
  }

  /** Campos para assinatura manual — a emissão não constitui assinatura (RN-048, DP-005). */
  assinaturas(campos: string[]) {
    this.garantirEspaco(130);
    const d = this.doc;
    d.moveDown(2.5);
    const larg = (this.largura - 30 * (campos.length - 1)) / campos.length;
    const y = d.y + 30;
    campos.forEach((c, i) => {
      const x = MARGEM + i * (larg + 30);
      d.moveTo(x, y).lineTo(x + larg, y).lineWidth(0.7).strokeColor('#000').stroke();
      d.font('Helvetica').fontSize(9).fillColor('#000').text(c, x, y + 4, { width: larg, align: 'center' });
      d.fontSize(8).fillColor('#555').text('Data: ____/____/________', x, y + 18, { width: larg, align: 'center' });
    });
    d.y = y + 40;
    d.x = MARGEM;
    d.moveDown(1);
    d.font('Helvetica-Oblique').fontSize(7.5).fillColor('#555').text(
      'A emissão deste documento pelo sistema não constitui assinatura. A validade depende das assinaturas manuais acima.',
      MARGEM, undefined, { width: this.largura, align: 'center' },
    );
  }

  garantirEspaco(altura: number) {
    if (this.doc.y + altura > this.doc.page.height - MARGEM - 30) this.doc.addPage();
  }

  async finalizar(): Promise<Buffer> {
    const d = this.doc;
    const paginas = d.bufferedPageRange();
    for (let i = 0; i < paginas.count; i++) {
      d.switchToPage(paginas.start + i);
      if (this.cab.marcaDagua) {
        d.save().rotate(-35, { origin: [d.page.width / 2, d.page.height / 2] })
          .font('Helvetica-Bold').fontSize(64).fillColor('#000').opacity(0.07)
          .text(this.cab.marcaDagua, 0, d.page.height / 2 - 40, { width: d.page.width, align: 'center', lineBreak: false })
          .restore().opacity(1);
      }
      d.page.margins.bottom = 0;
      const y = d.page.height - MARGEM + 10;
      d.font('Helvetica').fontSize(7.5).fillColor('#666').text(
        `${this.cab.numero} · Emitido em ${formatarDataHora(new Date().toISOString())} · Página ${i + 1} de ${paginas.count}`,
        MARGEM, y, { width: this.largura, align: 'center', lineBreak: false },
      );
    }
    d.end();
    return this.fim;
  }
}
