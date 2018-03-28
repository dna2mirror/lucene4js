const i_path = require('path');
const i_lucene = require('./lucene70/reader');

const common_stops = [
   '~', '`', '!', '@', '#', '$', '%', '^', '&', '*', '(', ')',
   '-', '_', '=', '+', '{', '}', '[', ']', '\\', '|', ':', ';',
   '"', '\'', ',', '.', '<', '>', '/', '?', ' ', '\t', '\r', '\n'
];

function tokenize(text, keep_stops) {
   let output = [];
   let n = text.length;
   let last = 0;
   for (let i = 0; i < n; i++) {
      let ch = text.charAt(i);
      if (common_stops.indexOf(ch) >= 0) {
         if (last < i) {
            output.push(text.substring(last, i));
         }
         if (keep_stops) output.push(ch);
         last = i + 1;
      }
   }
   if (last < n) output.push(text.substring(last));
   output = output.map((x) => x.toLowerCase());
   return output;
}

// e.g. /lucene/data
const path = process.argv[2] || 'C:/Users/kuldeeps/Desktop/test_file';
const field_id = 2;

function tf(engine) {
   // should read tf from .doc; no time thus generate tf at runtime
   let doc_bulks = engine.stored_field_chunks;
   let doc_ri = {}, doc_tf = {}, doc_df = {};
   doc_bulks.forEach((bulk, bulk_index) => {
      bulk.raw.forEach((row, row_index) => {
         let tokens = tokenize(row[field_id]);
         let f = {};
         tokens.forEach((term) => {
            if (f[term]) f[term]++; else f[term] = 1;
         });
         Object.keys(f).forEach((term) => {
            if (term === 'constructor') return;
            if (doc_ri[term]) doc_ri[term].push([bulk_index, row_index]); else doc_ri[term] = [[bulk_index, row_index]];
            if (doc_df[term]) doc_df[term]++; else doc_df[term] = 1;
         });
         doc_tf[bulk_index + ',' + row_index] = f;
      });
   });
   engine.index = {
      doc_ri, doc_tf, doc_df
   }
}

function df(engine, term) {
   // read df from Lucene .tim
   let term_bulks = engine.term_blocks;
   let target = null;
   term_bulks.forEach((bulk) => {
      if (target) return;
      target = bulk.terms.filter((x) => x.doc_freq && x.value === term)[0];
   });
   return target && target.doc_freq || 0;
}

function search(engine, text) {
   let tokens = tokenize(text);
   let doc_set = {};
   tokens.forEach((term) => {
      let ri = engine.index.doc_ri[term];
      ri != null && ri.forEach((doc) => {
         doc_set[doc[0] + ',' + doc[1]] = true;
      });
   });


   doc_set = Object.keys(doc_set).map((id) => {
      let index = id.split(',');
      return {
         id: id,
         bulk_index: parseInt(index[0]),
         row_index: parseInt(index[1]),
         score: 0
      };
   });
   let doc_n = engine.stored_field_chunks.map((bulk) => bulk.doc_n).reduce((x, y) => x+y);
   let dfv = {};
   tokens.forEach((term) => {
      dfv[term] = engine.index.doc_df[term] || df(engine, term);
   });
   doc_set.forEach((doc) => {
      let tfv = engine.index.doc_tf[doc.id];
      doc.meta = engine.stored_field_chunks[doc.bulk_index].raw[doc.row_index];
      doc.score = tokens.map((term) => {
         if (!tfv[term]) return 0;
         if (!dfv[term]) return 0;
         let value = (1+Math.log(tfv[term])) * Math.log(doc_n/dfv[term]);
         return value;
      }).reduce((x,y) => x+y);
   })
   doc_set = doc_set.sort((x,y) => y.score - x.score).slice(0, 10);
   return doc_set;
}

function search_api(text) {
   let cfs_data = i_lucene.readCFS(
      i_path.join(path, '_0.cfs'),
      i_lucene.readCFE(i_path.join(path, '_0.cfe'))
   );
   let engine = cfs_data.sys;
   // console.log(JSON.stringify(engine, null, 3));
   tf(engine);
   let result = search(engine, text);
   return result;
}

// console.log(JSON.stringify(read_cfe('/Users/admin/Desktop/test/dna/mirror/lucene4js/local/data/_0.cfe'), null , 3));
// read_si('/Users/admin/Desktop/test/dna/mirror/lucene4js/local/data/_0.si');
// console.log(JSON.stringify(read_segments_N(get_segments_N('/Users/admin/Desktop/test/dna/mirror/lucene4js/local/data')), null, 3));

////////////////////////////////////////////////////////////////////////////// debug
// let result = search_api(path, 'NGC TestNg against a TestVM');
// console.log(JSON.stringify(result, null, 3));

module.exports = {
   search: search_api
}
