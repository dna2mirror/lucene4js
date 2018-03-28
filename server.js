const express = require('express');
const bodyParser = require('body-parser');
const request = require('request');
const app = express()


app.use(express.static('style'));
app.use(bodyParser.urlencoded({ extended: true }));
app.set('view engine', 'ejs')

app.get('/', function (req, res) {
  res.render('index', {search_result: null, error: null});
})

app.post('/', function (req, res) {
  let query = req.body.query;
  console.log(query)
  search_result = search(query)
  query = " Dummy Search result for  " + query 
  res.render('index', {query:search_result,error: null});  
})

app.listen(3000, function () {
  console.log('Example app listening on port 3000!')
})

//TODO- Implement this method
function search(line){
	result = [{value: line}, {value: line},{value: line}, {value: line}];
	console.log(result)
	return result;
}