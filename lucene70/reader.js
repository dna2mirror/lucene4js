const i_path = require('path');
const i_utils = require('../utils');

const magic = 0x3fd76c17;
const VERSION_70 = 7;
const VERSION_AUTO_PREFIX_TERMS_REMOVED = 3;
const VERSION_PACKED_REMOVED = 6;
const VERSION_NO_NODE_ARC_COUNTS = 5;
const BLOCK_SIZE = 128;
const ARCS_AS_FIXED_ARRAY = 32;
const VERSION_VINT_TARGET = 4;

function bufToArray(buf) {
   let array = [];
   for (let i = 0, n = buf.length; i < n; i++) {
      array.push(buf[i]);
   }
   return array.join(',');
}

function read_magic(env) {
   let info = {};
   info.magic = env.buf.readInt32BE(env.offset);
   env.offset += 4;
   info.type = read_string(env);
   info.current_version = env.buf.readInt32BE(env.offset);
   env.offset += 4;
   return info;
}

function read_header(env) {
   let base = env.offset;
   let info = read_magic(env);
   info.id = bufToArray(env.buf.slice(env.offset, env.offset + 16));
   env.offset += 16;
   info.suffix = read_string(env);
   info.length = env.offset - base;
   return info;
}

function read_v_int(env) {
   let b = env.buf[env.offset++];
   if ((b & 0x80) === 0) return b;
   let i = b & 0x7f;
   b = env.buf[env.offset++];
   i |= (b & 0x7f) << 7;
   if ((b & 0x80) === 0) return i;
   b = env.buf[env.offset++];
   i |= (b & 0x7f) << 14;
   if ((b & 0x80) === 0) return i;
   b = env.buf[env.offset++];
   i |= (b & 0x7f) << 21;
   if ((b & 0x80) === 0) return i;
   b = env.buf[env.offset++];
   i |= (b & 0x0f) << 28;
   if ((b & 0xf0) === 0) return i;
   throw 'invalid vint (too many bits)';
}

function read_v_long(env, allow_neg) {
   let b = env.buf[env.offset++];
   if ((b & 0x80) === 0) return b;
   let i = b & 0x7f;
   b = env.buf[env.offset++];
   i |= (b & 0x7f) << 7;
   if ((b & 0x80) === 0) return i;
   b = env.buf[env.offset++];
   i |= (b & 0x7f) << 14;
   if ((b & 0x80) === 0) return i;
   b = env.buf[env.offset++];
   i |= (b & 0x7f) << 21;
   if ((b & 0x80) === 0) return i;
   b = env.buf[env.offset++];
   i |= (b & 0x7f) << 28;
   if ((b & 0x80) === 0) return i;
   b = env.buf[env.offset++];
   i |= (b & 0x7f) << 35;
   if ((b & 0x80) === 0) return i;
   b = env.buf[env.offset++];
   i |= (b & 0x7f) << 42;
   if ((b & 0x80) === 0) return i;
   b = env.buf[env.offset++];
   i |= (b & 0x7f) << 49;
   if ((b & 0x80) === 0) return i;
   b = env.buf[env.offset++];
   i |= (b & 0x7f) << 56;
   if ((b & 0x80) === 0) return i;
   if (allow_neg) {
      b = env.buf[env.offset++];
      if (b === 0 || b === 1) return i | (b & 0x7f) << 63;
   }
   throw 'invalid vlong (too many bits)';
}

function read_string(env) {
   let n = read_v_int(env);
   let p = env.offset + n;
   let str = env.buf.slice(env.offset, p).toString();
   env.offset = p;
   return str;
}

function read_term_string(env, addition) {
   let n = read_v_int(env);
   let term = {};
   if (addition) {
      addition = (n & 1) === 1;
      n >>= 1;
   }
   let p = env.offset + n;
   let str = env.buf.slice(env.offset, p).toString();
   env.offset = p;
   term.value = str;
   if (addition) {
      term.delta_fp = read_v_long(env);
   }
   return term;
}

function read_map_strings(env) {
   let n = read_v_int(env);
   let map = {};
   while (n > 0) {
      let key = read_string(env);
      let val = read_string(env);
      map[key] = val;
      n --;
   }
   return map;
}

function read_set_strings(env) {
   let n = read_v_int(env);
   let list = [];
   while (n > 0) {
      list.push(read_string(env));
      n --;
   }
   return list;
}

function read_byteref(env) {
   let n = read_v_int(env);
   let buf = env.buf.slice(env.offset, env.offset+n);
   env.offset += n;
   return buf;
}

function read_bit_int(env, local_offset, bit_len) {
   let int = 0;
   let t = env.buf[env.offset];
   int = t & ((1 << (8-local_offset)) - 1);
   bit_len -= 8 - local_offset;
   while (bit_len > 0) {
      bit_len -= 8;
      env.offset++;
      int <<= 8;
      int |= env.buf[env.offset];
   }
   if (bit_len === 0) {
      env.offset ++;
      local_offset = 0;
   } else {
      int >>= -bit_len;
      local_offset = 8 + bit_len;
   }
   return {
      offset: local_offset,
      value: int
   };
}

//////////////////////////////////////////////////////////////////////////////

const i_fs = require('fs');
function read_cfe_entry(env) {
   let s, p;
   s = env.offset;
   p = s + env.buf[s]+1;
   let entry = {};
   entry.name = env.buf.slice(s+1, p).toString();
   env.offset = p;
   entry.startIndex = i_utils.Bytes.readInt64BE(env.buf, p);
   p += 8;
   entry.length = i_utils.Bytes.readInt64BE(env.buf, p);
   p += 8;
   env.offset = p;
   return entry;
}

function read_cfe(filename) {
   let env = {
      buf: i_utils.Storage.read_file(filename),
      offset: 0
   };
   env.header = read_header(env);
   if (env.header.magic !== magic) {
      throw 'invalid Lucene70 magic';
   }
   env.compound_files = {
      n: read_v_int(env),
      list: []
   };
   for (let i = env.compound_files.n; i > 0; i--) {
      env.compound_files.list.push(read_cfe_entry(env));
   }
   delete env.buf;
   delete env.offset;
   return env;
}

//////////////////////////////////////////////////////////////////////////////

const cfs_reader_map = {
   tim: read_tim,
   tip: read_tip,
   doc: read_doc,
   pos: read_pos,
   fdt: read_fdt,
   fdx: read_fdx,
   /*
   fnm: read_fnm,
   nvd: read_nvd,
   nvm: read_nvm,
   */
}

/*
function cache_fst_root_arcs(env, sys, fstobj, data) {
   data = {offset: 0, buf: data};
   let arc = {};
   if (data.buf[data.offset++] === ARCS_AS_FIXED_ARRAY) {
      arc.arc_n = read_v_int(data);
      if (fstobj.current_version >= VERSION_VINT_TARGET) {
         arc.bytes_per_arc = read_v_int(data);
      } else {
         arc.bytes_per_arc = data.buf.readInt32BE(data.offset);
         data.offset += 4;
      }
      arc.arc_idx = -1;
      arc.next_arc = data.offset;
      arc.pos_start = data.offset;
   } else {
      arc.next_arc = 0;
      arc.bytes_per_arc = 0;
   }
   return read_fst_next_real_arc(env, sys, arc, fstobj, data);
}
function read_label(data, input_type) {
   let label = 0;
   switch(input_type) {
      case 0:
      label = data.buf[data.offset++];
      break;
      case 1:
      label = data.buf.readInt16BE(data.offset);
      data.offset += 2;
      break;
      default:
      label = read_v_int(data);
   }
   return label;
}
function read_fst_next_real_arc(env, sys, arc, fstobj, data) {
   const BIT_FINAL_ARC = 1;
   const BIT_LAST_ARC = 2;
   const BIT_TARGET_NEXT = 4;
   const BIT_STOP_NODE = 8;
   const BIT_ARC_HAS_OUTPUT = 16;
   const BIT_ARC_HAS_FINAL_OUTPUT = 32;
   if (arc.bytes_per_arc !== 0) {
      // arcs are at fixed entries
      arc.arc_idx ++;
      data.offset = arc.pos_start + arc.arc_idx*arc.bytes_per_arc;
   } else {
      // arcs are packed
      data.offset = arc.next_arc;
   }
   arc.flags = data.buf[data.offset++];
   arc.label = read_label(data, fstobj.input_type);
   if ((arc.flags & BIT_ARC_HAS_OUTPUT) === 0) {
      arc.output = null;
   } else {
      arc.output = read_byteref(data);
   }
   if ((arc.flags & BIT_ARC_HAS_FINAL_OUTPUT) === 0) {
      arc.next_final_output = null;
   }
   if ((arc.flags & BIT_STOP_NODE) !== 0) {
      if ((arc.flags & BIT_FINAL_ARC) === 0) {
         arc.target = 0;
      } else {
         arc.target = -1;
      }
   } else if ((arc.flags & BIT_TARGET_NEXT) !== 0) {
      arc.next = data.offset;
      if (arc.flags & BIT_LAST_ARC === 0) {
         if (arc.bytes_per_arc === 0) {
            // seek to next node
            while(true) {
               let flags = data.buf[data.offset++];
               read_label(data, fstobj.input_type);
               if ((flags & BIT_ARC_HAS_OUTPUT) !== 0) {
               }
            }
         } else {
            data.offset = arc.pos_start + arc.arc_n*arc.bytes_per_arc;
         }
      }
      arc.target = data.offset;
   } else {
      if (fstobj.current_version < VERSION_VINT_TARGET) {
         arc.target = data.buf.readInt32BE(data.offset);
         data.offset += 4;
      } else {
         arc.target = read_v_long(data);
      }
      arc.next_arc = data.offset;
   }
}
*/

function read_fst(env, sys) {
   let fstobj = read_magic(env);
   if (fstobj.current_version < VERSION_PACKED_REMOVED) {
      if (env.buf[env.offset++] === 1) {
         throw 'cannot read packed FSTs anymore';
      }
   }
   if (env.buf[env.offset++] === 1) {
      fstobj.empty_bytes = read_byteref(env);
   }
   fstobj.input_type = Math.pow(2, env.buf[env.offset++]);
   fstobj.start_node = read_v_long(env);
   if (fstobj.current_version < VERSION_NO_NODE_ARC_COUNTS) {
      // skip 24 bytes
      read_v_long(env);
      read_v_long(env);
      read_v_long(env);
   }
   fstobj.data_n = read_v_long(env);
   let data = env.buf.slice(env.offset, env.offset+fstobj.data_n).reverse();
   // cache_fst_root_arcs(env, sys, fstobj, data);
   return fstobj;
}

function read_term_block(env, sys) {
   let term_block = {
      start_fp: env.offset
   };
   let sub = false;
   let n = read_v_int(env) >> 1;
   term_block.term_n = n;
   let suffix_len = read_v_long(env);
   sub = (suffix_len & 1) === 0;
   term_block.terms = [];
   for (let i = term_block.term_n; i > 0; i--) {
      term_block.terms.push(read_term_string(env, sub));
   }
   let stats = {buf: read_byteref(env, sub), offset: 0};
   for (let i = 0; i < n; i++) {
      let term = term_block.terms[i];
      if (term.delta_fp) {
      } else {
         term.doc_freq = read_v_int(stats);
         term.total_term_freq = read_v_long(stats);
      }
   }
   let metas = {buf: read_byteref(env, sub), offset: 0};
   for (let i = 0; i < n; i++) {
      let term = term_block.terms[i];
      if (term.delta_fp) {
      } else {
         term.doc_fp_delta = read_v_long(metas);
         term.pos_fp_delta = read_v_long(metas);
      }
   }
   sys.term_blocks.push(term_block);
}
function fill_term_block_prefix(env, sys) {
   for (let i = sys.term_blocks.length-1; i >= 0; i--) {
      let term_block = sys.term_blocks[i];
      term_block.terms.forEach((term) => {
         if (!term.delta_fp) return;
         let block = sys.term_blocks.filter((one) => one.start_fp === term_block.start_fp - term.delta_fp)[0];
         if (!block) return;
         block.prefix = (term_block.prefix || '') + term.value;
      });
   }
   for (let i = 1, n = sys.term_blocks.length; i < n; i++) {
      let term_block = sys.term_blocks[i];
      let last_term_block = sys.term_blocks[i-1];
      if (term_block.prefix) continue;
      if (!last_term_block.prefix) continue;
      if (term_block.terms.filter((term) => term.delta_fp).length > 0) continue; // not correct
      term_block.prefix = last_term_block.prefix;
   }
   for (let i = 0, n = sys.term_blocks.length; i < n; i++) {
      let term_block = sys.term_blocks[i];
      if (!term_block.prefix) continue;
      term_block.terms.forEach((term) => {
         term.value = term_block.prefix + term.value;
      });
   }
}

function read_tim(env, sys) {
   env.header = read_header(env);
   if (env.header.current_version < VERSION_AUTO_PREFIX_TERMS_REMOVED) {
      // skip 1 byte, this byte should be 0
      env.offset += 1;
   }
   env.term_header = read_header(env);
   env.term_header.blocksize = read_v_int(env); // should be BLOCK_SIZE
   sys.term_blocks = [];
   let context_startIndex = env.offset;
   let directory_startIndex = i_utils.Bytes.readInt64BE(env.buf, env.buf.length - 16 - 8);
   while (env.offset < directory_startIndex) {
      read_term_block(env, sys);
   }
   fill_term_block_prefix(env, sys);
   env.offset = directory_startIndex;
   sys.field_n = read_v_int(env);
   sys.fields = [];
   for (let i = sys.field_n; i > 0; i--) {
      let fieldobj = {
         id: read_v_int(env),
         term_n: read_v_long(env),
         root_code: read_byteref(env),
         // if IndexOptions.DOCS: -1 or vvvvv
         sum_total_term_freq: read_v_long(env),
         sum_doc_freq: read_v_long(env),
         doc_count: read_v_int(env),
         longs_size: read_v_int(env),
         min_term: read_byteref(env),
         max_term: read_byteref(env)
      }
      fieldobj.root_block_fp = read_v_long({
         buf: fieldobj.root_code,
         offset: 0
      }) >> 2;
      sys.fields.push(fieldobj);
   }
}
function read_tip(env, sys) {
   env.header = read_header(env);
   let context_startIndex = env.offset;
   let directory_startIndex = i_utils.Bytes.readInt64BE(env.buf, env.buf.length - 16 - 8);
   env.offset = directory_startIndex;
   for (let i = 0, n = sys.field_n; i < n; i++) {
      sys.fields[i].index_start_fp = read_v_long(env);
   }
   for (let i = sys.field_n-1; i >= 0; i--) {
      env.offset = sys.fields[i].index_start_fp;
      sys.fields[i].fst = read_fst(env);
   }
}

function read_doc(env, sys) {
   env.header = read_header(env);
}
function read_pos(env, sys) {
   env.header = read_header(env);
}

function read_stored_field_index(env, sys) {
   let block_n = read_v_int(env);
   if (block_n === 0) return false;
   let block = {};
   block.doc_base = read_v_int(env);
   block.avg_chunk_docs = read_v_int(env);
   block.bits_per_doc_base_delta = read_v_int(env);
   block.doc_base_deltas = read_byteref(env);
   block.start_pointer_base = read_v_long(env);
   block.avg_chunk_size = read_v_long(env);
   block.bits_per_start_point_delta = read_v_int(env);
   block.start_pointer_deltas = read_byteref(env);
   sys.field_blocks.push(block);
   return true;
}

function read_stored_field_chunk(env, sys) {
   let chunk = {};
   chunk.base_doc = read_v_int(env);
   chunk.doc_n = read_v_int(env) >> 1;
   if (chunk.doc_n === 1) {
      chunk.doc_field_counts = read_v_int(env);
      chunk.doc_length = read_v_int(env);
   } else {
      chunk.doc_field_bits_required = read_v_int(env);
      if (chunk.doc_field_bits_required === 0) {
         chunk.doc_field_counts = read_v_int(env);
      }
      chunk.doc_length_bits_required = read_v_int(env);
      if (chunk.doc_length_bits_required === 0) {
         chunk.doc_length = read_v_int(env);
      }
   }
   if (!chunk.doc_length) {
      let doc_offset = [0];
      let bit_offset = 0, local_bit_offset = 0;
      for (let i = chunk.doc_n; i > 0; i--) {
         let bitop = read_bit_int(env, local_bit_offset, chunk.doc_length_bits_required);
         local_bit_offset = bitop.offset;
         doc_offset.push(doc_offset[doc_offset.length-1] + bitop.value);
      }
      chunk.doc_length = doc_offset[chunk.doc_n];
      if (local_bit_offset > 0) env.offset++;
   }
   chunk.start_fp = env.offset;
   let docs = i_utils.Bytes.decompressLZ4(env.buf.slice(env.offset, env.offset+chunk.doc_length), chunk.doc_length);
   chunk.raw = docs.data.toString();
   chunk.length = docs.offset;
   env.offset += docs.offset;
   if (chunk.doc_n > 0) sys.stored_field_chunks.push(chunk);
}

function read_fdx(env, sys) {
   env.header = read_header(env);
   env.packed_ints_version = read_v_int(env);
   sys.field_blocks = [];
   while(read_stored_field_index(env, sys));
}
function read_fdt(env, sys) {
   env.header = read_header(env);
   env.chunk_size = read_v_int(env);
   env.packed_ints_version = read_v_int(env);
   let context_startIndex = env.offset;
   let count_startIndex = env.buf.length - 16 - 1;
   for (let i = 2; i > 0; i--) {
      count_startIndex--;
      while ((env.buf[count_startIndex] & 0x80) !== 0) {
         count_startIndex--;
      }
   }
   count_startIndex ++;
   env.offset = count_startIndex;
   env.chunk_count = read_v_long(env);
   env.dirty_chunk_count = read_v_long(env);
   env.offset = context_startIndex;
   sys.stored_field_chunks = [];
   for (let i = env.chunk_count; i > 0; i--) {
      read_stored_field_chunk(env, sys);
   }
}
function read_fnm(env, sys) {
   env.header = read_header(env);
}

function read_nvd(env, sys) {
   env.header = read_header(env);
}
function read_nvm(env, sys) {
   env.header = read_header(env);
}

function read_cfs(filename, cfe) {
   let env = {
      buf: i_utils.Storage.read_file(filename),
      offset: 0,
      sys: {}
   };
   env.header = read_header(env);
   env.files = {};
   cfe.compound_files.list.forEach((filemeta) => {
      let name = filemeta.name.split('.');
      let fileobj = {
         name: name[1],
         codec: name[0],
         startIndex: filemeta.startIndex,
         endIndex: filemeta.startIndex + filemeta.length,
         buf: env.buf.slice(filemeta.startIndex, filemeta.startIndex + filemeta.length),
         offset: 0
      };
      name = name[1];
      env.files[name] = fileobj;
      let read = cfs_reader_map[name];
      if (read) read(fileobj, env.sys);
      delete fileobj.buf;
      delete fileobj.offset;
   });
   delete env.buf;
   delete env.offset;
   return env;
}

//////////////////////////////////////////////////////////////////////////////

function read_version(env) {
   let version = { cur: [] };
   let p = env.offset;
   version.cur.push(env.buf.readInt32BE(p));
   p += 4;
   version.cur.push(env.buf.readInt32BE(p));
   p += 4;
   version.cur.push(env.buf.readInt32BE(p));
   p += 4;
   if (env.buf[p] === 1) {
      version.min = [];
      p += 1;
      version.min.push(env.buf.readInt32BE(p));
      p += 4;
      version.min.push(env.buf.readInt32BE(p));
      p += 4;
      version.min.push(env.buf.readInt32BE(p));
      p += 4;
   } else if (env.buf[p] === 0) {
      version.min = [0, 0, 0];
   } else {
      throw 'invalid version';
   }
   env.offset = p;
   return version;
}

function read_segment_info(env) {
   let info = {};
   let p = env.offset;
   info.doc_n = env.buf.readInt32BE(p);
   p += 4;
   info.is_compound = env.buf[p] === 1;
   p += 1;
   env.offset = p;
   info.diagnostics = read_map_strings(env);
   info.files = read_set_strings(env);
   info.attributes = read_map_strings(env);
   // TODO: sort fields; see also Lucene70SegmentInfoFormat#read
   return info;
}

function read_si(filename) {
   let env = {
      buf: i_utils.Storage.read_file(filename),
      offset: 0
   }
   env.header = read_header(env);
   env.version = read_version(env);
   env.segment_info = read_segment_info(env);
   delete env.buf;
   delete env.offset;
   return env;
}

//////////////////////////////////////////////////////////////////////////////

function read_segment_infos(env) {
   let info = {};
   info.version = i_utils.Bytes.readInt64BE(env.buf, env.offset);
   env.offset += 8;
   if (env.header.current_version > VERSION_70) {
      info.counter = read_v_long(env);
   } else {
      info.counter = env.buf.readInt32BE(env.offset);
      env.offset += 4;
   }
   info.segment_n = env.buf.readInt32BE(env.offset);
   env.offset += 4;
   if (info.segment_n > 0) {
      env.version.min = [read_v_int(env), read_v_int(env), read_v_int(env)];
   }
   info.segments = [];
   for (let i = info.segment_n; i > 0; i--) {
      let segment = {};
      segment.name = read_string(env);
      segment.id = bufToArray(env.buf.slice(env.offset, env.offset+16));
      env.offset += 16;
      segment.codec = read_string(env);
      segment.del_gen = i_utils.Bytes.signedLong(i_utils.Bytes.readInt64BE(env.buf, env.offset));
      env.offset += 8;
      segment.del_count = env.buf.readInt32BE(env.offset);
      env.offset += 4;
      segment.field_infos_gen = i_utils.Bytes.signedLong(i_utils.Bytes.readInt64BE(env.buf, env.offset));
      env.offset += 8;
      segment.dv_gen = i_utils.Bytes.signedLong(i_utils.Bytes.readInt64BE(env.buf, env.offset));
      env.offset += 8;
      segment.field_infos_files = read_set_strings(env);
      segment.dv_field_n = env.buf.readInt32BE(env.offset);
      env.offset += 4;
      if (segment.dv_field_n > 0) {
         segment.dv_fields = {};
         for (let j = segment.dv_field_n; j > 0; j--) {
            env.offset += 4;
            segment.dv_fields[env.buf.readInt32BE(env.offset-4)] = read_set_strings(env);
         }
      }
      info.segments.push(segment);
   }
   info.user_data = read_map_strings(env);
   return info;
}

function read_segments_N(filename) {
   let env = {
      buf: i_utils.Storage.read_file(filename),
      offset: 0
   };
   env.header = read_header(env);
   env.version = {
      cur: [read_v_int(env), read_v_int(env), read_v_int(env)]
   };
   if (env.header.current_version >= VERSION_70) env.index_version = read_v_int(env);
   env.segment_infos = read_segment_infos(env);
   delete env.buf;
   delete env.offset;
   return env;
}

function get_segments_N(path) {
   let file_list = i_utils.Storage.list_files(path);
   return file_list.filter((filename) => i_path.basename(filename).startsWith('segments_'))[0];
}

console.log(JSON.stringify(
   read_cfs(
      '/Users/admin/Desktop/test/dna/mirror/lucene4js/local/data/_0.cfs',
      read_cfe('/Users/admin/Desktop/test/dna/mirror/lucene4js/local/data/_0.cfe')
   ), null , 3
));
// console.log(JSON.stringify(read_cfe('/Users/admin/Desktop/test/dna/mirror/lucene4js/local/data/_0.cfe'), null , 3));
// read_si('/Users/admin/Desktop/test/dna/mirror/lucene4js/local/data/_0.si');
// console.log(JSON.stringify(read_segments_N(get_segments_N('/Users/admin/Desktop/test/dna/mirror/lucene4js/local/data')), null, 3));

// .doc, .tim, .pos, .nvd, .fdx, .tip, .fdt, .nvm, .fnm
/**
 * - doc: Frequencies
 * pos: Positions
 * - tim: Termdictionary
 * - tip: Termindex
 * - fnm: FieldInfos
 * pay: Payloads
 * tvd: This file stores terms, frequencies, positions, offsets and payloads for every document.
 * - fdt: This file stores a compact representation of documents in compressed blocks of 16KB or more.
 * liv: optional, and only exists when a segment contains deletions
 * dim: has both blocks and the index split values, for each field
 * dvd: DocValues data
 * dvm: DocValues metadata
 * - pos
 * - nvd
 * - fdx
 * - nvm
 */

module.exports = {
   readCFE: read_cfe,
   readCFS: read_cfs,
   readSI: read_si,
   readSegmentsN: read_segments_N,
   getSegmentsN: get_segments_N
};