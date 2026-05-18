const { DOMParser, XMLSerializer } = require('@xmldom/xmldom');

const parser = new DOMParser();
const serializer = new XMLSerializer();

const baseXml = `<?xml version="1.0" encoding="UTF-8"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
    <p:cSld>
        <p:spTree>
            <p:nvGrpSpPr/>
        </p:spTree>
    </p:cSld>
</p:sld>`;

const doc = parser.parseFromString(baseXml, "application/xml");
const spTree = doc.getElementsByTagName("p:spTree")[0];

const shapeXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sp xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
    <p:nvSpPr><p:cNvPr id="1000" name="TextBox 1000"/></p:nvSpPr>
    <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="10" cy="10"/></a:xfrm></p:spPr>
    <p:txBody><a:p><a:r><a:t>Hello</a:t></a:r></a:p></p:txBody>
</p:sp>`;

const shapeDoc = parser.parseFromString(shapeXml, "application/xml");
spTree.appendChild(shapeDoc.documentElement.cloneNode(true));

console.log(serializer.serializeToString(doc));
