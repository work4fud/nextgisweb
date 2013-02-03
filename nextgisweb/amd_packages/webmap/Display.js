define([
    "dojo/_base/declare",
    "dijit/_WidgetBase",
    "dijit/_TemplatedMixin",
    "dijit/_WidgetsInTemplateMixin",
    "dojo/text!./templates/Display.html",
    "dojo/_base/lang",
    "dojo/_base/array",
    "dojo/Deferred",
    "dojo/promise/all",
    "ngw/openlayers",
    "ngw/openlayers/Map",
    "dijit/form/DropDownButton",
    "dijit/DropDownMenu",
    "dijit/MenuItem",
    "dijit/layout/ContentPane",
    "dijit/form/ToggleButton",
    "dojo/dom-style",
    "dojo/store/JsonRest",
    "dojo/request/xhr",
    // дерево слоев
    "dojo/data/ItemFileWriteStore",
    "cbtree/models/TreeStoreModel",
    "cbtree/Tree",
    "dijit/tree/dndSource",
    // template
    "dijit/layout/TabContainer",
    "dijit/layout/BorderContainer",
    "dijit/layout/ContentPane",
    "dojox/layout/TableContainer",
    "dijit/Toolbar",
    "dijit/form/Button",
    "dijit/form/Select",
    "dijit/form/DropDownButton",
    "dijit/ToolbarSeparator"
], function (
    declare,
    _WidgetBase,
    _TemplatedMixin,
    _WidgetsInTemplateMixin,
    template,
    lang,
    array,
    Deferred,
    all,
    openlayers,
    Map,
    DropDownButton,
    DropDownMenu,
    MenuItem,
    ContentPane,
    ToggleButton,
    domStyle,
    JsonRest,
    xhr,
    ItemFileWriteStore,
    TreeStoreModel,
    Tree,
    dndSource
) {
    var CustomItemFileWriteStore = declare([ItemFileWriteStore], {
        dumpItem: function (item) {
            var obj = {};

            if (item) {
                var attributes = this.getAttributes(item);

                if (attributes && attributes.length > 0) {
                    var i;

                    for(i = 0; i < attributes.length; i++){
                        var values = this.getValues(item, attributes[i]);

                        if (values) {
                            if(values.length > 1 ){
                                var j;

                                obj[attributes[i]] = [];
                                for (j = 0; j < values.length; j++ ) {
                                    var value = values[j];

                                    if (this.isItem(value)) {
                                        obj[attributes[i]].push(this.dumpItem(value));
                                    } else {
                                        obj[attributes[i]].push(value);
                                    };
                                };
                            } else {
                                if (this.isItem(values[0])) {
                                    obj[attributes[i]] = this.dumpItem(values[0]);
                                } else {
                                    obj[attributes[i]] = values[0];
                                };
                            };
                        };
                    };
                };
            };

            return obj;
        }
    });

    var LoggedDeferred = declare(Deferred, {
        constructor: function (name) {
            this.then(
                function () {
                    console.log("Deferred object [%s] resolved", name)
                },
                function () {
                    console.error("Deferred object [%s] rejected", name)
                }
            );
        }
    })

    return declare([_WidgetBase, _TemplatedMixin, _WidgetsInTemplateMixin], {
        templateString: template,

        // Загрузка разных видов модулей: adapter, basemap, plugin
        _midDeferred: undefined,

        // Инициализация хранилища элементов веб-карты
        _itemStoreDeferred: undefined,

        // Виджет карты с базовыми слоями создан
        _mapDeferred: undefined,

        // Слои элементов карты созданы
        _layersDeferred: undefined,

        // Вызов после postCreate
        _postCreateDeferred: undefined,

        // Вызов после startup
        _startupDeferred: undefined,

        constructor: function (options) {
            declare.safeMixin(this, options);

            this._itemStoreDeferred = new LoggedDeferred("_itemStoreDeferred");
            this._mapDeferred = new LoggedDeferred("_mapDeferred");
            this._layersDeferred = new LoggedDeferred("_layersDeferred");
            this._postCreateDeferred = new LoggedDeferred("_postCreateDeferred");
            this._startupDeferred = new LoggedDeferred("_startupDeferred");

            var widget = this;

            // Асинхронная загрузка необходимых модулей
            this._midDeferred = {};
            this._mid = {};
            array.forEach(Object.keys(this.config.mid), function (k) {
                var deferred = new LoggedDeferred("_midDeferred." + k);
                this._midDeferred[k] = deferred;

                var midarr = this.config.mid[k];
                require(midarr, function () {
                    var obj = {};
                    for (var i = 0; i < arguments.length; i++) {
                        obj[midarr[i]] = arguments[i];
                    };

                    widget._mid[k] = obj;

                    deferred.resolve(obj);
                });
            }, this);

            // Хранилище
            this._itemStoreSetup();
            
            this._mapDeferred.then(
                function () { widget._itemStorePrepare(); }
            );

            // Модель
            this.itemModel = new TreeStoreModel({
                store: this.itemStore,
                checkedAttr: "checked",
                query: { type: 'root' }
            });

            this.displayProjection = new openlayers.Projection('EPSG:3857');
            this.lonlatProjection = new openlayers.Projection('EPSG:4326');

            this._extent = new openlayers.Bounds(this.config.extent)
                .transform(this.lonlatProjection, this.displayProjection);

            
            // Дерево элементов слоя
            this.itemTree = new Tree({
                style: "height: 100%",
                model: this.itemModel,
                autoExpand: true,
                showRoot: false,
                dndController: dndSource
            });

            // Размещаем дерево, когда виджет будет готов           
            this._postCreateDeferred.then(
                function () { widget.itemTree.placeAt(widget.layerTreePane); }
            );

            // Выбранный элемент
            this.itemTree.watch("selectedItem", function (attr, oldVal, newVal) {
                widget.set("item", newVal);
            })

            // Карта
            all([this._midDeferred.basemap, this._startupDeferred]).then(
                function () {
                    widget._mapSetup();
                }
            );

            all([this._mapDeferred, this._postCreateDeferred]).then(
                function () {
                    // Формируем список слоев базовых карты в списке выбора
                    array.forEach(Object.keys(widget.map.layers), function (key) {
                        var layer = widget.map.layers[key];
                        if (layer.isBaseLayer) {
                            widget.basemapSelect.addOption({
                                value: key,
                                label: layer.title
                            });
                        };
                    });

                    // И добавляем возможность переключения
                    widget.basemapSelect.watch("value", function (attr, oldVal, newVal) {
                        widget.map.olMap.setBaseLayer(widget.map.layers[newVal].olLayer);
                    });
                }
            );

            // Слои элементов
            all([this._midDeferred.adapter, this._itemStoreDeferred]).then(
                function () {
                    widget._layersSetup();
                }
            );

            all([this._layersDeferred, this._mapSetup]).then(
                function () {
                    // Добавляем слои на карту 
                    widget._mapAddLayers();

                    // Связываем изменение чекбокса с видимостью слоя
                    var store = widget.itemStore;
                    store.on("Set", function (item, attr, oldVal, newVal) {
                        if (attr == "checked" && store.getValue(item, "type") == "layer") {
                            var id = store.getValue(item, "id");
                            var layer = widget._layers[id];
                            layer.set("visibility", newVal);
                        }
                    });
                }
            );

            
            // Плагины
            all([this._midDeferred.plugin, this._postCreateDeferred]).then(
                function () {
                    widget._pluginsSetup()
                }
            );


            // Инструменты
            this.tools = [];
        },

        postCreate: function () {
            this.inherited(arguments);
            this._postCreateDeferred.resolve();
        },

        startup: function () {
            this.inherited(arguments);
            // this.loadBookmarks();
            this._startupDeferred.resolve();
        },

        addTool: function (tool) {
            var btn = new ToggleButton({
                label: tool.label
            }).placeAt(this.mapToolbar);

            this.tools.push(tool);

            var display = this;
            btn.watch("checked", function (attr, oldVal, newVal) {
                array.forEach(display.tools, function (t) {
                    var state = newVal;
                    
                    if (t != tool) {
                        state = !state;
                    };

                    if (state) {
                        t.activate();
                    } else {
                        t.deactivate();
                    };
                });
            })
        },

        loadBookmarks: function () {
            if (this.bookmarkLayerId) {
                var store = new JsonRest({
                    target: ngwConfig.applicationUrl + '/layer/' + this.bookmarkLayerId + '/store_api/'
                });

                var display = this;

                store.query().then(
                    function (data) {
                        array.forEach(data, function (f) {

                            // Собираем подпись из всех-подряд полей, кроме id
                            var labelParts = [];
                            array.forEach(Object.keys(f), function (k) {
                                if (k != 'id') {
                                    labelParts.push(f[k]);
                                };
                            });
                            var label = labelParts.join(" ");

                            display.bookmarkMenu.addChild(new MenuItem({
                                label: label,
                                onClick: function () {
                                    
                                    // Отдельно запрашиваем экстент объекта
                                    xhr.get(ngwConfig.applicationUrl + '/layer/' + display.bookmarkLayerId + '/store_api/' + f.id, {
                                        handleAs: 'json',
                                        headers: { 'X-Feature-Box': true }
                                    }).then(
                                        function data(data) {
                                            display.map.olMap.zoomToExtent(data.box);
                                        }
                                    );
                                }
                            }));
                        });
                    }
                );
            } else {
                // Если слой с закладками не указан, то прячем кнопку
                domStyle.set(this.bookmarkButton.domNode, 'display', 'none');
            }
        },

        _itemStoreSetup: function () {
            var itemConfigById = {};

            function prepare_item(item) {
                // В хранилище переносим только самое необходимое и то, что
                // может меняться в процессе работы с картой.
                var copy = {
                    id: item.id,
                    type: item.type,
                    label: item.label
                };

                if (copy.type == 'layer') {
                    copy.layerId = item.layerId;
                    copy.styleId = item.styleId;

                    copy.visibility = null;
                    copy.checked = item.visibility;
                    
                } else if (copy.type == 'group' || copy.type == 'root') {
                    copy.children = array.map(item.children, function (c) { return prepare_item(c); });
                };

                // Для всего остального строим индекс
                itemConfigById[item.id] = item;

                return copy;
            };

            var rootItem = prepare_item(this.config.rootItem);

            this.itemStore = new CustomItemFileWriteStore({data: {
                identifier: "id",
                label: "label",
                items: [ rootItem ]
            }});

            this._itemConfigById = itemConfigById;
        },

        _itemStorePrepare: function () {
            var widget = this;

            this.itemStore.fetch({
                queryOptions: { deep: true },
                onItem: function (item) {
                    widget._itemStorePrepareItem(item);
                },
                onComplete: function (items) {
                    widget.itemStore.on("Set", function (item, attr, oldVal, newVal) {
                        // При изменении атрибута checked следим за изменениями
                        // в списке видимых слоев
                        if (attr == "checked") { widget._itemStoreVisibility(item); };
                    });

                    widget._itemStoreDeferred.resolve();
                },
                onError: function (error) {
                    widget._itemStoreDeferred.reject();
                }
            })
        },

        _itemStorePrepareItem: function (item) {
            this._itemStoreVisibility(item);
        },

        _itemStoreVisibility: function (item) {
            var store = this.itemStore;

            if (store.getValue(item, "type") == "layer") {
                var newVal = store.getValue(item, "checked");
                if (store.getValue(item, "visibility") != newVal) {
                    console.log("Layer [%s] visibility has changed to [%s]", store.getValue(item, "id"), newVal);
                    store.setValue(item, "visibility", newVal);
                };
            };
        },

        _mapSetup: function () {
            // Инициализация карты и базовых слоев
            this.map = new Map(this.mapNode, {});
            this.map.olMap.zoomToExtent(this._extent);
            this._mapDeferred.resolve();
        },

        _mapAddLayers: function () {
            array.forEach(this._layer_order, function (id) {
                this.map.addLayer(this._layers[id]);
            }, this);
        },

        _adaptersSetup: function () {
            // Создаем экземпляры всех классов адаптеров
            this._adapters = {};
            array.forEach(Object.keys(this._mid.adapter), function (k) {
                this._adapters[k] = new this._mid.adapter[k]({
                    display: this
                })
            }, this);
        },

        _layersSetup: function () {
            var widget = this, store = this.itemStore;

            this._adaptersSetup();

            this._layers = {};              // Список всех слоев по id
            this._layer_order = [];         // Порядок слоев от нижнего к верхнему
            
            // Инициализация слоев
            store.fetch({
                query: {type: 'layer'},
                queryOptions: {deep: true},
                onItem: function (item) {
                    widget._layerSetup(item);
                    widget._layer_order.push(store.getValue(item, "id"));
                },
                onComplete: function () {
                    widget._layersDeferred.resolve();
                },
                onError: function (error) {
                    console.error(error);
                    widget._layersDeferred.reject();
                }
            })
        },

        _layerSetup: function (item) {
            var store = this.itemStore;
            
            var data = this._itemConfigById[store.getValue(item, "id")];
            var adapter = this._adapters[data.adapter];

            var layer = adapter.createLayer(data);

            layer.itemId = data.id;
            layer.itemConfig = data;

            this._layers[data.id] = layer;
        },

        _pluginsSetup: function () {
            this._plugins = {};
            
            var widget = this;
            array.forEach(Object.keys(this._mid.plugin), function(key) {
                console.log("Plugin [%s]::constructor...", key);

                var plugin =  new this._mid.plugin[key]({
                    identity: key,
                    display: this,
                    itemStore: this.itemStore,
                });

                widget._postCreateDeferred.then(
                    function () {
                        console.log("Plugin [%s]::postCreate...", key);
                        plugin.postCreate();

                        widget._startupDeferred.then(
                            function () {
                                console.log("Plugin [%s]::startup...", key);
                                plugin.startup();

                                widget._plugins[key] = plugin;
                                console.info("Plugin [%s] registered", key);
                            }
                        );
                    }
                );
            }, this);
        },

        _itemGetter: function () {
            return this._item;
        },

        _itemSetter: function (value) {
            // TODO: Выделение элемента в дереве по значению
            this._item = value;
        },

        _itemConfigGetter: function () {
            return this._itemConfigById[
                this.itemStore.getValue(this._item, "id")
            ]
        },

        getVisibleItems: function() {
            var store = this.itemStore,
                deferred = new Deferred();

            store.fetch({
                query: {type: "layer", visibility: "true"},
                queryOptions: {deep: true},
                onComplete: function (items) {
                    deferred.resolve(items);
                },
                onError: function (error) {
                    deferred.reject(error);
                }
            });

            return deferred;
        }
    });
});