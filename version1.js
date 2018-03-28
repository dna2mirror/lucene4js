const i_lucene = require('./lucene70/reader');

////////////////////////////////////////////////////////////////////////////// debug
let cfs_data = i_lucene.readCFS(
   '/Users/admin/Desktop/test/dna/mirror/lucene4js/local/data/_0.cfs',
   i_lucene.readCFE('/Users/admin/Desktop/test/dna/mirror/lucene4js/local/data/_0.cfe')
);
let engine = cfs_data.sys;
let chunks = engine.stored_field_chunks;
let doc_id = 57769;
let chunk = chunks.filter((one) => one.base_doc <= doc_id && one.base_doc + one.doc_n > doc_id)[0];
if (chunk) console.log(chunk.raw[doc_id - chunk.base_doc]);
console.log(JSON.stringify(engine, null, 3));

// console.log(JSON.stringify(read_cfe('/Users/admin/Desktop/test/dna/mirror/lucene4js/local/data/_0.cfe'), null , 3));
// read_si('/Users/admin/Desktop/test/dna/mirror/lucene4js/local/data/_0.si');
// console.log(JSON.stringify(read_segments_N(get_segments_N('/Users/admin/Desktop/test/dna/mirror/lucene4js/local/data')), null, 3));
