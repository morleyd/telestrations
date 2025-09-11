<!-- Adapted from https://www.w3schools.com/colors/colors_picker.asp -->
<template>
  <v-menu v-model="visible" location="center" :close-on-content-click="false">
    <template v-slot:activator="{ props }">
      <div class="preview" @click="onOpen" v-bind="props" :style="{ background: outerPreviewColor }"></div>
    </template>
    <div id="colorPicker">
      <img style="margin-right:2px; cursor: pointer;" src="@/assets/img_colormap.gif" usemap="#colormap" alt="colormap">
      <map id="colormap" name="colormap">
        <area style="cursor:pointer" shape="poly" coords="63,0,72,4,72,15,63,19,54,15,54,4"
          @click="clickColor('#003366', -200, 54)" loc="-200, 54" alt="#003366">
        <area style="cursor:pointer" shape="poly" coords="81,0,90,4,90,15,81,19,72,15,72,4"
          @click="clickColor('#336699', -200, 72)" loc="-200, 72" alt="#336699">
        <area style="cursor:pointer" shape="poly" coords="99,0,108,4,108,15,99,19,90,15,90,4"
          @click="clickColor('#3366CC', -200, 90)" loc="-200, 90" alt="#3366CC">
        <area style="cursor:pointer" shape="poly" coords="117,0,126,4,126,15,117,19,108,15,108,4"
          @click="clickColor('#003399', -200, 108)" loc="-200, 108" alt="#003399">
        <area style="cursor:pointer" shape="poly" coords="135,0,144,4,144,15,135,19,126,15,126,4"
          @click="clickColor('#000099', -200, 126)" loc="-200, 126" alt="#000099">
        <area style="cursor:pointer" shape="poly" coords="153,0,162,4,162,15,153,19,144,15,144,4"
          @click="clickColor('#0000CC', -200, 144)" loc="-200, 144" alt="#0000CC">
        <area style="cursor:pointer" shape="poly" coords="171,0,180,4,180,15,171,19,162,15,162,4"
          @click="clickColor('#000066', -200, 162)" loc="-200, 162" alt="#000066">
        <area style="cursor:pointer" shape="poly" coords="54,15,63,19,63,30,54,34,45,30,45,19"
          @click="clickColor('#006666', -185, 45)" loc="-185, 45" alt="#006666">
        <area style="cursor:pointer" shape="poly" coords="72,15,81,19,81,30,72,34,63,30,63,19"
          @click="clickColor('#006699', -185, 63)" loc="-185, 63" alt="#006699">
        <area style="cursor:pointer" shape="poly" coords="90,15,99,19,99,30,90,34,81,30,81,19"
          @click="clickColor('#0099CC', -185, 81)" loc="-185, 81" alt="#0099CC">
        <area style="cursor:pointer" shape="poly" coords="108,15,117,19,117,30,108,34,99,30,99,19"
          @click="clickColor('#0066CC', -185, 99)" loc="-185, 99" alt="#0066CC">
        <area style="cursor:pointer" shape="poly" coords="126,15,135,19,135,30,126,34,117,30,117,19"
          @click="clickColor('#0033CC', -185, 117)" loc="-185, 117" alt="#0033CC">
        <area style="cursor:pointer" shape="poly" coords="144,15,153,19,153,30,144,34,135,30,135,19"
          @click="clickColor('#0000FF', -185, 135)" loc="-185, 135" alt="#0000FF">
        <area style="cursor:pointer" shape="poly" coords="162,15,171,19,171,30,162,34,153,30,153,19"
          @click="clickColor('#3333FF', -185, 153)" loc="-185, 153" alt="#3333FF">
        <area style="cursor:pointer" shape="poly" coords="180,15,189,19,189,30,180,34,171,30,171,19"
          @click="clickColor('#333399', -185, 171)" loc="-185, 171" alt="#333399">
        <area style="cursor:pointer" shape="poly" coords="45,30,54,34,54,45,45,49,36,45,36,34"
          @click="clickColor('#669999', -170, 36)" loc="-170, 36" alt="#669999">
        <area style="cursor:pointer" shape="poly" coords="63,30,72,34,72,45,63,49,54,45,54,34"
          @click="clickColor('#009999', -170, 54)" loc="-170, 54" alt="#009999">
        <area style="cursor:pointer" shape="poly" coords="81,30,90,34,90,45,81,49,72,45,72,34"
          @click="clickColor('#33CCCC', -170, 72)" loc="-170, 72" alt="#33CCCC">
        <area style="cursor:pointer" shape="poly" coords="99,30,108,34,108,45,99,49,90,45,90,34"
          @click="clickColor('#00CCFF', -170, 90)" loc="-170, 90" alt="#00CCFF">
        <area style="cursor:pointer" shape="poly" coords="117,30,126,34,126,45,117,49,108,45,108,34"
          @click="clickColor('#0099FF', -170, 108)" loc="-170, 108" alt="#0099FF">
        <area style="cursor:pointer" shape="poly" coords="135,30,144,34,144,45,135,49,126,45,126,34"
          @click="clickColor('#0066FF', -170, 126)" loc="-170, 126" alt="#0066FF">
        <area style="cursor:pointer" shape="poly" coords="153,30,162,34,162,45,153,49,144,45,144,34"
          @click="clickColor('#3366FF', -170, 144)" loc="-170, 144" alt="#3366FF">
        <area style="cursor:pointer" shape="poly" coords="171,30,180,34,180,45,171,49,162,45,162,34"
          @click="clickColor('#3333CC', -170, 162)" loc="-170, 162" alt="#3333CC">
        <area style="cursor:pointer" shape="poly" coords="189,30,198,34,198,45,189,49,180,45,180,34"
          @click="clickColor('#666699', -170, 180)" loc="-170, 180" alt="#666699">
        <area style="cursor:pointer" shape="poly" coords="36,45,45,49,45,60,36,64,27,60,27,49"
          @click="clickColor('#339966', -155, 27)" loc="-155, 27" alt="#339966">
        <area style="cursor:pointer" shape="poly" coords="54,45,63,49,63,60,54,64,45,60,45,49"
          @click="clickColor('#00CC99', -155, 45)" loc="-155, 45" alt="#00CC99">
        <area style="cursor:pointer" shape="poly" coords="72,45,81,49,81,60,72,64,63,60,63,49"
          @click="clickColor('#00FFCC', -155, 63)" loc="-155, 63" alt="#00FFCC">
        <area style="cursor:pointer" shape="poly" coords="90,45,99,49,99,60,90,64,81,60,81,49"
          @click="clickColor('#00FFFF', -155, 81)" loc="-155, 81" alt="#00FFFF">
        <area style="cursor:pointer" shape="poly" coords="108,45,117,49,117,60,108,64,99,60,99,49"
          @click="clickColor('#33CCFF', -155, 99)" loc="-155, 99" alt="#33CCFF">
        <area style="cursor:pointer" shape="poly" coords="126,45,135,49,135,60,126,64,117,60,117,49"
          @click="clickColor('#3399FF', -155, 117)" loc="-155, 117" alt="#3399FF">
        <area style="cursor:pointer" shape="poly" coords="144,45,153,49,153,60,144,64,135,60,135,49"
          @click="clickColor('#6699FF', -155, 135)" loc="-155, 135" alt="#6699FF">
        <area style="cursor:pointer" shape="poly" coords="162,45,171,49,171,60,162,64,153,60,153,49"
          @click="clickColor('#6666FF', -155, 153)" loc="-155, 153" alt="#6666FF">
        <area style="cursor:pointer" shape="poly" coords="180,45,189,49,189,60,180,64,171,60,171,49"
          @click="clickColor('#6600FF', -155, 171)" loc="-155, 171" alt="#6600FF">
        <area style="cursor:pointer" shape="poly" coords="198,45,207,49,207,60,198,64,189,60,189,49"
          @click="clickColor('#6600CC', -155, 189)" loc="-155, 189" alt="#6600CC">
        <area style="cursor:pointer" shape="poly" coords="27,60,36,64,36,75,27,79,18,75,18,64"
          @click="clickColor('#339933', -140, 18)" loc="-140, 18" alt="#339933">
        <area style="cursor:pointer" shape="poly" coords="45,60,54,64,54,75,45,79,36,75,36,64"
          @click="clickColor('#00CC66', -140, 36)" loc="-140, 36" alt="#00CC66">
        <area style="cursor:pointer" shape="poly" coords="63,60,72,64,72,75,63,79,54,75,54,64"
          @click="clickColor('#00FF99', -140, 54)" loc="-140, 54" alt="#00FF99">
        <area style="cursor:pointer" shape="poly" coords="81,60,90,64,90,75,81,79,72,75,72,64"
          @click="clickColor('#66FFCC', -140, 72)" loc="-140, 72" alt="#66FFCC">
        <area style="cursor:pointer" shape="poly" coords="99,60,108,64,108,75,99,79,90,75,90,64"
          @click="clickColor('#66FFFF', -140, 90)" loc="-140, 90" alt="#66FFFF">
        <area style="cursor:pointer" shape="poly" coords="117,60,126,64,126,75,117,79,108,75,108,64"
          @click="clickColor('#66CCFF', -140, 108)" loc="-140, 108" alt="#66CCFF">
        <area style="cursor:pointer" shape="poly" coords="135,60,144,64,144,75,135,79,126,75,126,64"
          @click="clickColor('#99CCFF', -140, 126)" loc="-140, 126" alt="#99CCFF">
        <area style="cursor:pointer" shape="poly" coords="153,60,162,64,162,75,153,79,144,75,144,64"
          @click="clickColor('#9999FF', -140, 144)" loc="-140, 144" alt="#9999FF">
        <area style="cursor:pointer" shape="poly" coords="171,60,180,64,180,75,171,79,162,75,162,64"
          @click="clickColor('#9966FF', -140, 162)" loc="-140, 162" alt="#9966FF">
        <area style="cursor:pointer" shape="poly" coords="189,60,198,64,198,75,189,79,180,75,180,64"
          @click="clickColor('#9933FF', -140, 180)" loc="-140, 180" alt="#9933FF">
        <area style="cursor:pointer" shape="poly" coords="207,60,216,64,216,75,207,79,198,75,198,64"
          @click="clickColor('#9900FF', -140, 198)" loc="-140, 198" alt="#9900FF">
        <area style="cursor:pointer" shape="poly" coords="18,75,27,79,27,90,18,94,9,90,9,79"
          @click="clickColor('#006600', -125, 9)" loc="-125, 9" alt="#006600">
        <area style="cursor:pointer" shape="poly" coords="36,75,45,79,45,90,36,94,27,90,27,79"
          @click="clickColor('#00CC00', -125, 27)" loc="-125, 27" alt="#00CC00">
        <area style="cursor:pointer" shape="poly" coords="54,75,63,79,63,90,54,94,45,90,45,79"
          @click="clickColor('#00FF00', -125, 45)" loc="-125, 45" alt="#00FF00">
        <area style="cursor:pointer" shape="poly" coords="72,75,81,79,81,90,72,94,63,90,63,79"
          @click="clickColor('#66FF99', -125, 63)" loc="-125, 63" alt="#66FF99">
        <area style="cursor:pointer" shape="poly" coords="90,75,99,79,99,90,90,94,81,90,81,79"
          @click="clickColor('#99FFCC', -125, 81)" loc="-125, 81" alt="#99FFCC">
        <area style="cursor:pointer" shape="poly" coords="108,75,117,79,117,90,108,94,99,90,99,79"
          @click="clickColor('#CCFFFF', -125, 99)" loc="-125, 99" alt="#CCFFFF">
        <area style="cursor:pointer" shape="poly" coords="126,75,135,79,135,90,126,94,117,90,117,79"
          @click="clickColor('#CCCCFF', -125, 117)" loc="-125, 117" alt="#CCCCFF">
        <area style="cursor:pointer" shape="poly" coords="144,75,153,79,153,90,144,94,135,90,135,79"
          @click="clickColor('#CC99FF', -125, 135)" loc="-125, 135" alt="#CC99FF">
        <area style="cursor:pointer" shape="poly" coords="162,75,171,79,171,90,162,94,153,90,153,79"
          @click="clickColor('#CC66FF', -125, 153)" loc="-125, 153" alt="#CC66FF">
        <area style="cursor:pointer" shape="poly" coords="180,75,189,79,189,90,180,94,171,90,171,79"
          @click="clickColor('#CC33FF', -125, 171)" loc="-125, 171" alt="#CC33FF">
        <area style="cursor:pointer" shape="poly" coords="198,75,207,79,207,90,198,94,189,90,189,79"
          @click="clickColor('#CC00FF', -125, 189)" loc="-125, 189" alt="#CC00FF">
        <area style="cursor:pointer" shape="poly" coords="216,75,225,79,225,90,216,94,207,90,207,79"
          @click="clickColor('#9900CC', -125, 207)" loc="-125, 207" alt="#9900CC">
        <area style="cursor:pointer" shape="poly" coords="9,90,18,94,18,105,9,109,0,105,0,94"
          @click="clickColor('#003300', -110, 0)" loc="-110, 0" alt="#003300">
        <area style="cursor:pointer" shape="poly" coords="27,90,36,94,36,105,27,109,18,105,18,94"
          @click="clickColor('#009933', -110, 18)" loc="-110, 18" alt="#009933">
        <area style="cursor:pointer" shape="poly" coords="45,90,54,94,54,105,45,109,36,105,36,94"
          @click="clickColor('#33CC33', -110, 36)" loc="-110, 36" alt="#33CC33">
        <area style="cursor:pointer" shape="poly" coords="63,90,72,94,72,105,63,109,54,105,54,94"
          @click="clickColor('#66FF66', -110, 54)" loc="-110, 54" alt="#66FF66">
        <area style="cursor:pointer" shape="poly" coords="81,90,90,94,90,105,81,109,72,105,72,94"
          @click="clickColor('#99FF99', -110, 72)" loc="-110, 72" alt="#99FF99">
        <area style="cursor:pointer" shape="poly" coords="99,90,108,94,108,105,99,109,90,105,90,94"
          @click="clickColor('#CCFFCC', -110, 90)" loc="-110, 90" alt="#CCFFCC">
        <area style="cursor:pointer" shape="poly" coords="117,90,126,94,126,105,117,109,108,105,108,94"
          @click="clickColor('#FFFFFF', -110, 108)" loc="-110, 108" alt="#FFFFFF">
        <area style="cursor:pointer" shape="poly" coords="135,90,144,94,144,105,135,109,126,105,126,94"
          @click="clickColor('#FFCCFF', -110, 126)" loc="-110, 126" alt="#FFCCFF">
        <area style="cursor:pointer" shape="poly" coords="153,90,162,94,162,105,153,109,144,105,144,94"
          @click="clickColor('#FF99FF', -110, 144)" loc="-110, 144" alt="#FF99FF">
        <area style="cursor:pointer" shape="poly" coords="171,90,180,94,180,105,171,109,162,105,162,94"
          @click="clickColor('#FF66FF', -110, 162)" loc="-110, 162" alt="#FF66FF">
        <area style="cursor:pointer" shape="poly" coords="189,90,198,94,198,105,189,109,180,105,180,94"
          @click="clickColor('#FF00FF', -110, 180)" loc="-110, 180" alt="#FF00FF">
        <area style="cursor:pointer" shape="poly" coords="207,90,216,94,216,105,207,109,198,105,198,94"
          @click="clickColor('#CC00CC', -110, 198)" loc="-110, 198" alt="#CC00CC">
        <area style="cursor:pointer" shape="poly" coords="225,90,234,94,234,105,225,109,216,105,216,94"
          @click="clickColor('#660066', -110, 216)" loc="-110, 216" alt="#660066">
        <area style="cursor:pointer" shape="poly" coords="18,105,27,109,27,120,18,124,9,120,9,109"
          @click="clickColor('#336600', -95, 9)" loc="-95, 9" alt="#336600">
        <area style="cursor:pointer" shape="poly" coords="36,105,45,109,45,120,36,124,27,120,27,109"
          @click="clickColor('#009900', -95, 27)" loc="-95, 27" alt="#009900">
        <area style="cursor:pointer" shape="poly" coords="54,105,63,109,63,120,54,124,45,120,45,109"
          @click="clickColor('#66FF33', -95, 45)" loc="-95, 45" alt="#66FF33">
        <area style="cursor:pointer" shape="poly" coords="72,105,81,109,81,120,72,124,63,120,63,109"
          @click="clickColor('#99FF66', -95, 63)" loc="-95, 63" alt="#99FF66">
        <area style="cursor:pointer" shape="poly" coords="90,105,99,109,99,120,90,124,81,120,81,109"
          @click="clickColor('#CCFF99', -95, 81)" loc="-95, 81" alt="#CCFF99">
        <area style="cursor:pointer" shape="poly" coords="108,105,117,109,117,120,108,124,99,120,99,109"
          @click="clickColor('#FFFFCC', -95, 99)" loc="-95, 99" alt="#FFFFCC">
        <area style="cursor:pointer" shape="poly" coords="126,105,135,109,135,120,126,124,117,120,117,109"
          @click="clickColor('#FFCCCC', -95, 117)" loc="-95, 117" alt="#FFCCCC">
        <area style="cursor:pointer" shape="poly" coords="144,105,153,109,153,120,144,124,135,120,135,109"
          @click="clickColor('#FF99CC', -95, 135)" loc="-95, 135" alt="#FF99CC">
        <area style="cursor:pointer" shape="poly" coords="162,105,171,109,171,120,162,124,153,120,153,109"
          @click="clickColor('#FF66CC', -95, 153)" loc="-95, 153" alt="#FF66CC">
        <area style="cursor:pointer" shape="poly" coords="180,105,189,109,189,120,180,124,171,120,171,109"
          @click="clickColor('#FF33CC', -95, 171)" loc="-95, 171" alt="#FF33CC">
        <area style="cursor:pointer" shape="poly" coords="198,105,207,109,207,120,198,124,189,120,189,109"
          @click="clickColor('#CC0099', -95, 189)" loc="-95, 189" alt="#CC0099">
        <area style="cursor:pointer" shape="poly" coords="216,105,225,109,225,120,216,124,207,120,207,109"
          @click="clickColor('#993399', -95, 207)" loc="-95, 207" alt="#993399">
        <area style="cursor:pointer" shape="poly" coords="27,120,36,124,36,135,27,139,18,135,18,124"
          @click="clickColor('#333300', -80, 18)" loc="-80, 18" alt="#333300">
        <area style="cursor:pointer" shape="poly" coords="45,120,54,124,54,135,45,139,36,135,36,124"
          @click="clickColor('#669900', -80, 36)" loc="-80, 36" alt="#669900">
        <area style="cursor:pointer" shape="poly" coords="63,120,72,124,72,135,63,139,54,135,54,124"
          @click="clickColor('#99FF33', -80, 54)" loc="-80, 54" alt="#99FF33">
        <area style="cursor:pointer" shape="poly" coords="81,120,90,124,90,135,81,139,72,135,72,124"
          @click="clickColor('#CCFF66', -80, 72)" loc="-80, 72" alt="#CCFF66">
        <area style="cursor:pointer" shape="poly" coords="99,120,108,124,108,135,99,139,90,135,90,124"
          @click="clickColor('#FFFF99', -80, 90)" loc="-80, 90" alt="#FFFF99">
        <area style="cursor:pointer" shape="poly" coords="117,120,126,124,126,135,117,139,108,135,108,124"
          @click="clickColor('#FFCC99', -80, 108)" loc="-80, 108" alt="#FFCC99">
        <area style="cursor:pointer" shape="poly" coords="135,120,144,124,144,135,135,139,126,135,126,124"
          @click="clickColor('#FF9999', -80, 126)" loc="-80, 126" alt="#FF9999">
        <area style="cursor:pointer" shape="poly" coords="153,120,162,124,162,135,153,139,144,135,144,124"
          @click="clickColor('#FF6699', -80, 144)" loc="-80, 144" alt="#FF6699">
        <area style="cursor:pointer" shape="poly" coords="171,120,180,124,180,135,171,139,162,135,162,124"
          @click="clickColor('#FF3399', -80, 162)" loc="-80, 162" alt="#FF3399">
        <area style="cursor:pointer" shape="poly" coords="189,120,198,124,198,135,189,139,180,135,180,124"
          @click="clickColor('#CC3399', -80, 180)" loc="-80, 180" alt="#CC3399">
        <area style="cursor:pointer" shape="poly" coords="207,120,216,124,216,135,207,139,198,135,198,124"
          @click="clickColor('#990099', -80, 198)" loc="-80, 198" alt="#990099">
        <area style="cursor:pointer" shape="poly" coords="36,135,45,139,45,150,36,154,27,150,27,139"
          @click="clickColor('#666633', -65, 27)" loc="-65, 27" alt="#666633">
        <area style="cursor:pointer" shape="poly" coords="54,135,63,139,63,150,54,154,45,150,45,139"
          @click="clickColor('#99CC00', -65, 45)" loc="-65, 45" alt="#99CC00">
        <area style="cursor:pointer" shape="poly" coords="72,135,81,139,81,150,72,154,63,150,63,139"
          @click="clickColor('#CCFF33', -65, 63)" loc="-65, 63" alt="#CCFF33">
        <area style="cursor:pointer" shape="poly" coords="90,135,99,139,99,150,90,154,81,150,81,139"
          @click="clickColor('#FFFF66', -65, 81)" loc="-65, 81" alt="#FFFF66">
        <area style="cursor:pointer" shape="poly" coords="108,135,117,139,117,150,108,154,99,150,99,139"
          @click="clickColor('#FFCC66', -65, 99)" loc="-65, 99" alt="#FFCC66">
        <area style="cursor:pointer" shape="poly" coords="126,135,135,139,135,150,126,154,117,150,117,139"
          @click="clickColor('#FF9966', -65, 117)" loc="-65, 117" alt="#FF9966">
        <area style="cursor:pointer" shape="poly" coords="144,135,153,139,153,150,144,154,135,150,135,139"
          @click="clickColor('#FF6666', -65, 135)" loc="-65, 135" alt="#FF6666">
        <area style="cursor:pointer" shape="poly" coords="162,135,171,139,171,150,162,154,153,150,153,139"
          @click="clickColor('#FF0066', -65, 153)" loc="-65, 153" alt="#FF0066">
        <area style="cursor:pointer" shape="poly" coords="180,135,189,139,189,150,180,154,171,150,171,139"
          @click="clickColor('#CC6699', -65, 171)" loc="-65, 171" alt="#CC6699">
        <area style="cursor:pointer" shape="poly" coords="198,135,207,139,207,150,198,154,189,150,189,139"
          @click="clickColor('#993366', -65, 189)" loc="-65, 189" alt="#993366">
        <area style="cursor:pointer" shape="poly" coords="45,150,54,154,54,165,45,169,36,165,36,154"
          @click="clickColor('#999966', -50, 36)" loc="-50, 36" alt="#999966">
        <area style="cursor:pointer" shape="poly" coords="63,150,72,154,72,165,63,169,54,165,54,154"
          @click="clickColor('#CCCC00', -50, 54)" loc="-50, 54" alt="#CCCC00">
        <area style="cursor:pointer" shape="poly" coords="81,150,90,154,90,165,81,169,72,165,72,154"
          @click="clickColor('#FFFF00', -50, 72)" loc="-50, 72" alt="#FFFF00">
        <area style="cursor:pointer" shape="poly" coords="99,150,108,154,108,165,99,169,90,165,90,154"
          @click="clickColor('#FFCC00', -50, 90)" loc="-50, 90" alt="#FFCC00">
        <area style="cursor:pointer" shape="poly" coords="117,150,126,154,126,165,117,169,108,165,108,154"
          @click="clickColor('#FF9933', -50, 108)" loc="-50, 108" alt="#FF9933">
        <area style="cursor:pointer" shape="poly" coords="135,150,144,154,144,165,135,169,126,165,126,154"
          @click="clickColor('#FF6600', -50, 126)" loc="-50, 126" alt="#FF6600">
        <area style="cursor:pointer" shape="poly" coords="153,150,162,154,162,165,153,169,144,165,144,154"
          @click="clickColor('#FF5050', -50, 144)" loc="-50, 144" alt="#FF5050">
        <area style="cursor:pointer" shape="poly" coords="171,150,180,154,180,165,171,169,162,165,162,154"
          @click="clickColor('#CC0066', -50, 162)" loc="-50, 162" alt="#CC0066">
        <area style="cursor:pointer" shape="poly" coords="189,150,198,154,198,165,189,169,180,165,180,154"
          @click="clickColor('#660033', -50, 180)" loc="-50, 180" alt="#660033">
        <area style="cursor:pointer" shape="poly" coords="54,165,63,169,63,180,54,184,45,180,45,169"
          @click="clickColor('#996633', -35, 45)" loc="-35, 45" alt="#996633">
        <area style="cursor:pointer" shape="poly" coords="72,165,81,169,81,180,72,184,63,180,63,169"
          @click="clickColor('#CC9900', -35, 63)" loc="-35, 63" alt="#CC9900">
        <area style="cursor:pointer" shape="poly" coords="90,165,99,169,99,180,90,184,81,180,81,169"
          @click="clickColor('#FF9900', -35, 81)" loc="-35, 81" alt="#FF9900">
        <area style="cursor:pointer" shape="poly" coords="108,165,117,169,117,180,108,184,99,180,99,169"
          @click="clickColor('#CC6600', -35, 99)" loc="-35, 99" alt="#CC6600">
        <area style="cursor:pointer" shape="poly" coords="126,165,135,169,135,180,126,184,117,180,117,169"
          @click="clickColor('#FF3300', -35, 117)" loc="-35, 117" alt="#FF3300">
        <area style="cursor:pointer" shape="poly" coords="144,165,153,169,153,180,144,184,135,180,135,169"
          @click="clickColor('#FF0000', -35, 135)" loc="-35, 135" alt="#FF0000">
        <area style="cursor:pointer" shape="poly" coords="162,165,171,169,171,180,162,184,153,180,153,169"
          @click="clickColor('#CC0000', -35, 153)" loc="-35, 153" alt="#CC0000">
        <area style="cursor:pointer" shape="poly" coords="180,165,189,169,189,180,180,184,171,180,171,169"
          @click="clickColor('#990033', -35, 171)" loc="-35, 171" alt="#990033">
        <area style="cursor:pointer" shape="poly" coords="63,180,72,184,72,195,63,199,54,195,54,184"
          @click="clickColor('#663300', -20, 54)" loc="-20, 54" alt="#663300">
        <area style="cursor:pointer" shape="poly" coords="81,180,90,184,90,195,81,199,72,195,72,184"
          @click="clickColor('#996600', -20, 72)" loc="-20, 72" alt="#996600">
        <area style="cursor:pointer" shape="poly" coords="99,180,108,184,108,195,99,199,90,195,90,184"
          @click="clickColor('#CC3300', -20, 90)" loc="-20, 90" alt="#CC3300">
        <area style="cursor:pointer" shape="poly" coords="117,180,126,184,126,195,117,199,108,195,108,184"
          @click="clickColor('#993300', -20, 108)" loc="-20, 108" alt="#993300">
        <area style="cursor:pointer" shape="poly" coords="135,180,144,184,144,195,135,199,126,195,126,184"
          @click="clickColor('#990000', -20, 126)" loc="-20, 126" alt="#990000">
        <area style="cursor:pointer" shape="poly" coords="153,180,162,184,162,195,153,199,144,195,144,184"
          @click="clickColor('#800000', -20, 144)" loc="-20, 144" alt="#800000">
        <area style="cursor:pointer" shape="poly" coords="171,180,180,184,180,195,171,199,162,195,162,184"
          @click="clickColor('#993333', -20, 162)" loc="-20, 162" alt="#993333">
      </map>
      <div id="selectedhexagon" class="mt-n2"></div>
      <div style="display: grid; align-items: center; justify-items: center;">
        <div class="preview mt-n2" :style="{ background: hexColor }"></div>
        <v-btn class="mt-4" color="primary" @click="onSubmit">Done</v-btn>
      </div>
    </div>
  </v-menu>
</template>
<script>
export default {
  name: "ColorPicker",
  props: [
    "parent",
    "initialColor"
  ],
  data() {
    return {
      visible: false,
      hexColor: "#000066",
      outerPreviewColor: "#000066",
    };
  },
  mounted() {
    if (this.initialColor) {
      this.hexColor = this.initialColor
      this.outerPreviewColor = this.initialColor
    }
  },
  methods: {
    onOpen() {
      this.visible = true
      this.$nextTick(() => {
        let colormap = document.getElementById("colormap");
        let areas = colormap.getElementsByTagName("AREA");
        for (let i = 0; i < areas.length; i++) {
          let areacolor = areas[i].alt;
          if (areacolor.toLowerCase() == this.hexColor.toLowerCase()) {
            let location = areas[i].getAttribute("loc").split(",");
            this.clickColor(this.hexColor, Number(location[0]), Number(location[1]))
          }
        }
      });
    },
    clickColor(hex, seltop, selleft) {
      this.hexColor = hex
      let hexagon = document.getElementById("selectedhexagon")
      hexagon.style.top = seltop + "px";
      hexagon.style.left = selleft + "px";
    },
    onSubmit() {
      this.outerPreviewColor = this.hexColor
      this.visible = false
      this.$emit("selected", this.hexColor, this.parent)
    },
  },
}
</script>
<style>
#colorPicker {
  width: 260px;
  text-align: center;
  margin-inline: 12px;
  padding: 8px;
  border: 1px solid black;
  background: #ffffe6;
  position: fixed;
  z-index: 1000;
  bottom: 100px;
}

#selectedhexagon {
  visibility: visible;
  position: relative;
  width: 21px;
  height: 21px;
  background-image: url('@/assets/img_selectedcolor.gif');
  top: -200px;
  left: 162px;
}

.preview {
  height: 20px;
  width: 50px;
  border: 1px solid rgb(108, 108, 108);
  border-radius: 2px;
}
</style>
