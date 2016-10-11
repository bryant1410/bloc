#!/bin/bash

blocdir=$builddir/usr/lib/strato
blochome=$blocdir/bloc-server
projdir=$builddir/var/run/strato
projhome=$projdir/bloc-server

mkdir -p $blocdir
cp -a $submod $blochome
cd $blochome
rm -rf .git{,attributes,ignore}
npm install --quiet

mkdir -p $projdir
cd $projdir
$blochome/bin/main.js init --optIn --appName bloc-server --developer explorer --apiURL 'http://%APIURL%';
cd $projhome
npm install --quiet
node_modules/bower/bin/bower install --allow-root

