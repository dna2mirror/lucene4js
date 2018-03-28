const i_fs = require('fs');
const i_path = require('path');

const Storage = {
   list_directories: (dir) => {
      dir = i_path.resolve(dir);
      return i_fs.readdirSync(dir).filter((name) => {
         let subdir = path.join(dir, name);
         let state = i_fs.lstatSync(subdir);
         return state.isDirectory();
      });
   },
   list_files: (dir) => {
      dir = i_path.resolve(dir);
      let queue = [dir], list = [];
      while (queue.length > 0) {
         list_dir(queue.shift(), queue, list);
      }
      return list;

      function list_dir(dir, queue, list) {
         i_fs.readdirSync(dir).forEach((name) => {
            let filename = i_path.join(dir, name);
            let state = i_fs.lstatSync(filename);
            if (state.isDirectory()) {
               queue.push(filename);
            } else {
               list.push(filename);
            }
         });
      }
   },
   make_directory: (dir) => {
      dir = i_path.resolve(dir);
      let parent_dir = i_path.dirname(dir);
      let state = true;
      if (dir !== parent_dir) {
         if (!i_fs.existsSync(parent_dir)) {
            state = Storage.make_directory(parent_dir);
         } else {
            if (!i_fs.lstatSync(parent_dir).isDirectory()) {
               state = false;
            }
         }
         if (!state) {
            return null;
         }
      }
      if (!i_fs.existsSync(dir)) {
         i_fs.mkdirSync(dir);
         return dir;
      } else if (!i_fs.lstatSync(dir).isDirectory()) {
         return null;
      } else {
         return dir;
      }
   },
   remove_directory: (dir) => {
      if (dir.length < Storage.work_dir.length) {
         return false;
      }
      if (dir.indexOf(Storage.work_dir) !== 0) {
         return false;
      }
      if (!fs.existsSync(dir)) {
         return false;
      }
      fs.readdirSync(dir).forEach(function(file, index){
         var curPath = i_path.join(dir, file);
         if (i_fs.lstatSync(curPath).isDirectory()) {
            // recurse
            Storage.rmtree(curPath);
         } else { // delete file
            i_fs.unlinkSync(curPath);
         }
      });
      i_fs.rmdirSync(dir);
      return true;
   },
   read_file: (filename) => {
      return i_fs.readFileSync(filename);
   }
};

const Bytes = {
   readInt64BE: (buf, offset) => {
      let h = buf.readInt32BE(offset);
      let l = buf.readInt32BE(offset+4);
      return h << 32 | l;
   },
   signedLong: (long) => {
      if (long >> 63 === 1) {
         return 0xffffffffffffffff - long - 1;
      }
      return long;
   },
   decompressLZ4: (buf, limit) => {
      // fast_speed mode
      let len = buf.length + 7;
      let extra = len*8;
      if (extra < 3) extra = 3;
      len += extra;
      let out = Buffer.alloc(len);
      let i = 0, j = 0, t = 0;
      do {
         let token = buf[i++];
         let literal_len = token >> 4;
         if (literal_len !== 0) {
            if (literal_len === 0x0f) {
               t = buf[i++];
               while(t === 0xff) {
                  literal_len += t;
                  t = buf[i++];
               }
               literal_len += t;
            }
            copy(buf, out, literal_len);
         }
         if (j >= limit) break;
         if (i >= buf.length) break;

         let match_dec = buf[i++];
         match_dec |= (buf[i++] << 8);
         // match_dec should > 0
         let match_len = token & 0xf;
         if (match_len === 0xf) {
            t = buf[i++];
            while (t === 0xff) {
               match_len += t;
               t = buf[i++];
            }
            match_len += t;
         }
         match_len += 4 /* MIN_MATCH */

         let mi = i;
         i = j - match_dec;
         copy(out, out, match_len);
         i = mi;
      } while (j < limit && i < buf.length);
      return {
         offset: i,
         data: out.slice(0, j)
      };

      function copy(src, out, len) {
         while(len > 0) {
            out[j++] = src[i++];
            len --;
         }
      }
   }
};

module.exports = {
   Storage,
   Bytes
};